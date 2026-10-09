/** media 族的文本投影。 */
import { quoteForText, instanceZText } from "../../literals";
import { StoryCommand } from "../../../../contracts";
import { GenerateContext } from "../context";

export function generateMediaCommand(cmd: StoryCommand, c: GenerateContext): void {
  const { pad, out } = c;
  switch (cmd.op) {
    case "bgm":
    case "se":
    case "ambient":
    case "voice": {
      let line = `${pad}${cmd.op} ${quoteForText(cmd.resource as string)}`;
      if (cmd.volume !== undefined) line += ` volume=${cmd.volume}`;
      if (cmd.loop !== undefined) line += ` loop=${cmd.loop}`;
      if (cmd.fade !== undefined) line += ` fade=${cmd.fade}`;
      if (cmd.auto_stop !== undefined) line += ` auto_stop=${cmd.auto_stop}`;
      if (cmd.restart !== undefined) line += ` restart=${cmd.restart}`;
      out.push(line);
      return;
    }
    case "stop_bgm":
    case "stop_ambient":
    case "stop_voice": {
      let line = `${pad}${cmd.op}`;
      if (cmd.fade !== undefined) line += ` fade=${cmd.fade}`;
      out.push(line);
      return;
    }
    case "video":
    case "cutscene": {
      let line = `${pad}${cmd.op} ${quoteForText(cmd.resource as string)}`;
      if (cmd.volume !== undefined) line += ` volume=${cmd.volume}`;
      if (cmd.loop !== undefined) line += ` loop=${cmd.loop}`;
      if (cmd.skipable !== undefined) line += ` skipable=${cmd.skipable}`;
      line += instanceZText(cmd);
      out.push(line);
      return;
    }
    case "seek_video":
      out.push(`${pad}seek_video ${cmd.seconds}`);
      return;
    case "pause_video":
      out.push(`${pad}pause_video`);
      return;
    case "resume_video":
      out.push(`${pad}resume_video`);
      return;
    case "stop_video":
      out.push(`${pad}stop_video`);
      return;
    case "video_skipable":
      out.push(
        `${pad}video_skipable ${cmd.value === false ? "false" : "true"}`,
      );
      return;
  }
}
