/**
 * 常驻提示条：一块贴在舞台上沿的只读小牌子。
 *
 * 三条约定与宿主形态无关——样式内联、不依赖 stage.css；只读部分设
 * `pointerEvents: "none"`，不吃舞台上的点击；不读引擎状态（显隐由 `mount` 决定，
 * 文案由 `props` 给，操作走 `controls`）。
 */
export default function Hint(props: { text?: string }) {
  const text = props.text ?? "";
  if (text === "") return null;
  return (
    <div
      role="status"
      style={{
        position: "absolute",
        top: "1rem",
        left: "50%",
        transform: "translateX(-50%)",
        padding: "0.25rem 0.75rem",
        borderRadius: "999px",
        background: "rgba(0, 0, 0, 0.55)",
        color: "#f4f1e8",
        fontSize: "0.875rem",
        pointerEvents: "none",
      }}
    >
      {text}
    </div>
  );
}
