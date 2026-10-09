/** present 族的文本投影。 */
import { elementValueText } from "../element";
import { quoteForText, generateDictLiteral } from "../../literals";
import { StoryCommand } from "../../../../contracts";
import { GenerateContext } from "../context";

/**
 * 投影本族的 op 行（`show` `hide` `background` `bg_switch` `zindex` `style` `window` `animate` `animate_block` `transition` `shake` `text_typewriter`）。
 *
 * 入参是分发骨架建好的 `GenerateContext`：`pad` 是本行缩进前缀（块体逐层加深），
 * `out` 是输出缓冲，投影出的行直接推入，不留空行。
 * 无返回值，结果通过 `out` 交付。
 * 失败表现：字段无法投影（缺字符串、字典字段缺失等）时抛 `TextFormatError`，不是静默跳过——
 * 由上层按命令粒度捕获后降级为 issue，使整棵树的其余部分照常输出。
 */
export function generatePresentCommand(cmd: StoryCommand, c: GenerateContext): void {
  const { pad, out } = c;
  switch (cmd.op) {
    // ====== 元素增删改 ======
    case "show": {
      let line = `${pad}show ${quoteForText(cmd.target as string)}`;
      if (cmd.x !== undefined) line += ` x=${elementValueText(cmd.x)}`;
      if (cmd.y !== undefined) line += ` y=${elementValueText(cmd.y)}`;
      if (cmd.id !== undefined) line += ` id=${elementValueText(cmd.id)}`;
      if (cmd.name !== undefined) line += ` name=${elementValueText(cmd.name)}`;
      if (cmd.background === true) line += " background=true";
      else if (cmd.background === false) line += " background=false";
      out.push(line);
      return;
    }
    case "hide":
      out.push(`${pad}hide ${quoteForText(cmd.target as string)}`);
      return;
    case "background":
    case "bg_switch":
      out.push(`${pad}${cmd.op} ${quoteForText(cmd.resource as string)}`);
      return;
    case "zindex":
      out.push(
        `${pad}zindex ${quoteForText(cmd.target as string)} value=${cmd.value}`,
      );
      return;
    case "style":
      out.push(
        `${pad}style ${quoteForText(cmd.target as string)} props=${generateDictLiteral(cmd.props as Record<string, unknown>)}`,
      );
      return;
    case "window":
      out.push(`${pad}window ${cmd.mode as string}`);
      return;
    // ====== 帧驱动表现 ======
    case "animate": {
      let line = `${pad}animate ${quoteForText(cmd.target as string)} property=${elementValueText(cmd.property)} value=${cmd.value}`;
      if (cmd.duration !== undefined) line += ` duration=${cmd.duration}`;
      if (cmd.easing !== undefined)
        line += ` easing=${elementValueText(cmd.easing)}`;
      out.push(line);
      return;
    }
    case "animate_block": {
      let line = `${pad}animate_block ${quoteForText(cmd.target as string)}`;
      for (const key of ["x", "y", "opacity", "rotation", "scale"]) {
        if (cmd[key] !== undefined) line += ` ${key}=${cmd[key]}`;
      }
      if (cmd.duration !== undefined) line += ` duration=${cmd.duration}`;
      if (cmd.easing !== undefined)
        line += ` easing=${elementValueText(cmd.easing)}`;
      out.push(line);
      return;
    }
    case "transition": {
      let line = `${pad}transition ${quoteForText(cmd.type as string)}`;
      if (cmd.duration !== undefined) line += ` duration=${cmd.duration}`;
      out.push(line);
      return;
    }
    case "shake": {
      let line = `${pad}shake`;
      if (cmd.intensity !== undefined) line += ` intensity=${cmd.intensity}`;
      if (cmd.duration !== undefined) line += ` duration=${cmd.duration}`;
      out.push(line);
      return;
    }
    case "text_typewriter": {
      let line = `${pad}text_typewriter`;
      if (cmd.enabled !== undefined)
        line += ` enabled=${cmd.enabled ? "true" : "false"}`;
      if (cmd.speed !== undefined) line += ` speed=${cmd.speed}`;
      out.push(line);
      return;
    }
  }
}
