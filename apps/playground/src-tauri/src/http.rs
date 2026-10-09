//! HTTP 响应概念（通用底座）：`Range` 请求解析、MIME 判定、URL 段 percent 编码。
//!
//! 这些概念与加密/资源目录布局无关，故不落在加密实现内部；媒体回环服务与 lfstream
//! 协议处理器共用同一份实现。两条 Range 通道各有一个入口：头通道对畸形值宽容
//! （回全量），query 通道 fail-closed（拒绝即 416）——判定顺序不同，各自独立实现。

/// Range 请求解析结果：三段判定（全量 / 明确闭区间 / 无法满足）。
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RangeSpec {
    /// 无区间或畸形区间 → 按全量响应
    Full,
    /// 明确闭区间 `[start, end]`（已按文件长度钳尾）
    Partial(u64, u64),
    /// `start` 越界、区间倒置或后缀长度为 0 → 416
    Unsatisfiable,
}

/// query 通道解析出的 `bytes=` 规格（未按文件长度归一）。
enum RangeValue {
    /// 取值形态对，但数值/区间按本解析口径非法 → 调用方一律拒绝
    Invalid,
    /// `-n` 后缀形态
    Suffix(u64),
    /// `a-` / `a-b` 形态
    FromTo(u64, Option<u64>),
}

/// RFC 7233 单区间的形态与数值解析（不涉及文件长度），供 query 通道使用：
/// 先 trim 整值再吃 `bytes=` 前缀、要求恰一个 `-`，数值段可带空白。形态/数值任一不合
/// = `Invalid`——调用方 fail-closed 拒绝。
fn parse_range_value(value: &str) -> RangeValue {
    let Some(spec) = value.trim().strip_prefix("bytes=") else {
        return RangeValue::Invalid;
    };
    let Some((a, b)) = spec.split_once('-') else {
        return RangeValue::Invalid;
    };
    let (a, b) = (a.trim(), b.trim());
    if a.is_empty() {
        let Ok(n) = b.parse::<u64>() else {
            return RangeValue::Invalid;
        };
        RangeValue::Suffix(n)
    } else {
        let Ok(start) = a.parse::<u64>() else {
            return RangeValue::Invalid;
        };
        match b {
            "" => RangeValue::FromTo(start, None),
            _ => match b.parse::<u64>() {
                Ok(end) => RangeValue::FromTo(start, Some(end)),
                Err(_) => RangeValue::Invalid,
            },
        }
    }
}

/// Range 请求解析（RFC 7233 单区间：`bytes=a-b` / `bytes=a-` / `bytes=-n`）；
/// 缺失或畸形 = Full（宽容回全量）；start 越界 = Unsatisfiable（416）。
///
/// 两处容忍边界与 query 通道不同：整值前缀不做 trim（只 trim 数值段），且 `a-b` 的尾段
/// 解析失败不按畸形处理——起点合法时钳到文件尾，而后缀形态 `bytes=-n` 的数值失败才回全量。
/// 这两条边界决定响应状态码（200 / 206 / 416），与 query 通道的 fail-closed 语义不可互换。
pub(crate) fn parse_range(header: Option<&str>, total: u64) -> RangeSpec {
    let Some(h) = header else {
        return RangeSpec::Full;
    };
    let Some(spec) = h.strip_prefix("bytes=") else {
        return RangeSpec::Full;
    };
    let Some((a, b)) = spec.split_once('-') else {
        return RangeSpec::Full;
    };
    let parse = |s: &str| s.trim().parse::<u64>().ok();
    if a.is_empty() {
        let Some(n) = parse(b) else {
            return RangeSpec::Full;
        };
        if n == 0 || total == 0 {
            return RangeSpec::Unsatisfiable;
        }
        return RangeSpec::Partial(total.saturating_sub(n), total - 1);
    }
    let Some(start) = parse(a) else {
        return RangeSpec::Full;
    };
    if start >= total {
        return RangeSpec::Unsatisfiable;
    }
    let end = parse(b).map_or(total - 1, |e| e.min(total - 1));
    if end < start {
        return RangeSpec::Unsatisfiable;
    }
    RangeSpec::Partial(start, end)
}

/// query 通道**严格**解析（头通道的「畸形宽容回全量」不适用）：值须形如
/// `bytes=a-b` / `bytes=a-` / `bytes=-n`，其余一律拒绝。为何不宽容——显式通道上静默退化
/// 等于一次全文件解密，代价反被放大；此处 fail-closed。返回明文闭区间 `[start, end]`，
/// `None` = 拒绝（调用方回 416）。
pub(crate) fn parse_range_strict(value: &str, total: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return None;
    }
    match parse_range_value(value) {
        RangeValue::Invalid => None,
        RangeValue::Suffix(0) => None,
        RangeValue::Suffix(n) => Some((total.saturating_sub(n), total - 1)),
        RangeValue::FromTo(start, _) if start >= total => None,
        RangeValue::FromTo(start, end) => {
            let end = end.map_or(total - 1, |e| e.min(total - 1));
            (end >= start).then_some((start, end))
        }
    }
}

/// MIME（协议响应头——webview 媒体元素按 Content-Type 处理，替代旧 Blob type 参数）
pub(crate) fn mime_for(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "opus" => "audio/opus",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        // 前端产物经 v2 路径供给：module script/样式表的 MIME 必须精确，否则 WebView 拒执行
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" | "map" => "application/json",
        "html" => "text/html",
        _ => "application/octet-stream",
    }
}

/// URL 段编码（逻辑路径整段编码：`/` → %2F 使其成为协议 path 的单一段）
pub(crate) fn utf8_percent_encode(path: &str) -> String {
    const SEGMENT: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
        .remove(b'-')
        .remove(b'.')
        .remove(b'_');
    percent_encoding::utf8_percent_encode(path, SEGMENT).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lenient_header_channel_tolerates_malformed() {
        assert_eq!(parse_range(None, 100), RangeSpec::Full);
        assert_eq!(parse_range(Some("bytes=0-"), 100), RangeSpec::Partial(0, 99));
        assert_eq!(
            parse_range(Some("bytes=10-19"), 100),
            RangeSpec::Partial(10, 19)
        );
        assert_eq!(
            parse_range(Some("bytes=90-999"), 100),
            RangeSpec::Partial(90, 99)
        );
        assert_eq!(
            parse_range(Some("bytes=-10"), 100),
            RangeSpec::Partial(90, 99)
        );
        assert_eq!(parse_range(Some("bytes=100-"), 100), RangeSpec::Unsatisfiable);
        assert_eq!(parse_range(Some("garbage"), 100), RangeSpec::Full);
        assert_eq!(parse_range(Some("bytes=xx-yy"), 100), RangeSpec::Full);

        // 尾段畸形的两种处置：起点合法则钳到文件尾（不是回全量），后缀形态才回全量。
        // 这两条与 query 通道的 fail-closed 相反，是最容易被「统一成一份实现」改掉的地方。
        assert_eq!(parse_range(Some("bytes=0-abc"), 0), RangeSpec::Unsatisfiable);
        assert_eq!(
            parse_range(Some("bytes=0-abc"), 100),
            RangeSpec::Partial(0, 99)
        );
        assert_eq!(
            parse_range(Some("bytes=0-abc"), 1),
            RangeSpec::Partial(0, 0)
        );
        assert_eq!(
            parse_range(Some("bytes=0-18446744073709551616"), 100),
            RangeSpec::Partial(0, 99)
        );
        assert_eq!(
            parse_range(Some("bytes=0-10-20"), 100),
            RangeSpec::Partial(0, 99)
        );
        assert_eq!(
            parse_range(Some("bytes=0-1.5"), 100),
            RangeSpec::Partial(0, 99)
        );
        assert_eq!(parse_range(Some("bytes=-abc"), 100), RangeSpec::Full);

        // 前导空白不做整值 trim：与 `bytes=` 之间多一个空格即视为非本通道取值。
        assert_eq!(parse_range(Some(" bytes=0-10"), 100), RangeSpec::Full);
        assert_eq!(parse_range(Some(" bytes=100-"), 100), RangeSpec::Full);

        // 多区间不被支持：整串按单个 `-` 切分后尾段非法，同「尾段畸形」处置。
        assert_eq!(
            parse_range(Some("bytes=0-1,3-4"), 100),
            RangeSpec::Partial(0, 99)
        );
    }

    #[test]
    fn query_channel_is_fail_closed() {
        assert_eq!(parse_range_strict("bytes=10-19", 100), Some((10, 19)));
        assert_eq!(parse_range_strict("bytes=90-999", 100), Some((90, 99)));
        assert_eq!(parse_range_strict("bytes=90-", 100), Some((90, 99)));
        assert_eq!(parse_range_strict("bytes=-10", 100), Some((90, 99)));
        assert_eq!(parse_range_strict("bytes=100-", 100), None);
        assert_eq!(parse_range_strict("bytes=50-10", 100), None);
        assert_eq!(parse_range_strict("garbage", 100), None);
        assert_eq!(parse_range_strict("bytes=xx-yy", 100), None);
        assert_eq!(parse_range_strict("bytes=-0", 100), None);
        assert_eq!(parse_range_strict("bytes=0-", 0), None);
    }

    #[test]
    fn mime_and_percent_encoding_cover_frontend_artifacts() {
        assert_eq!(mime_for("Audio/x.mp3"), "audio/mpeg");
        assert_eq!(mime_for("a/b/main.MP4"), "video/mp4");
        assert_eq!(mime_for("index.js"), "text/javascript");
        assert_eq!(mime_for("noext"), "application/octet-stream");
        assert_eq!(utf8_percent_encode("Lang/en/main.json"), "Lang%2Fen%2Fmain.json");
    }
}
