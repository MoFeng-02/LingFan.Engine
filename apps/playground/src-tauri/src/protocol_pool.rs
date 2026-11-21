//! 自定义协议请求的工作线程池：把协议供给的解密/读盘移出 WebView 的 UI 线程。
//!
//! wry 在 Windows/macOS/iOS 上同步调用自定义协议处理器——处理器内若做解密/读盘，
//! 会直接阻塞 UI 线程（视频 seek 触发密集 Range 请求时尤其明显）。这里用固定规模的
//! worker 池承接请求：处理器只把任务投递进池即返回，响应经异步 responder 从 worker
//! 线程交付（见 lib.rs 的 `register_asynchronous_uri_scheme_protocol`）。
//! Android 的处理器本就在后台线程，经池同样不阻塞 UI（行为不回退）。
//!
//! 池规模是起步值，真机 profiling 后可调（性能契约：协议供给不得阻塞 UI 线程）。

use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

/// 固定 worker 数：并发承接协议请求的上限。起步值，待真机 profiling 定标。
const WORKERS: usize = 4;

/// 一个协议供给任务（自带响应交付，执行完即向 responder 回帧）。
type Job = Box<dyn FnOnce() + Send + 'static>;

static POOL_TX: OnceLock<Sender<Job>> = OnceLock::new();

fn sender() -> &'static Sender<Job> {
    POOL_TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Job>();
        // 多 worker 共享一个接收端：取任务的瞬间持锁，任务执行不持锁，worker 间并行。
        let rx = Arc::new(Mutex::new(rx));
        for _ in 0..WORKERS {
            let rx = Arc::clone(&rx);
            thread::Builder::new()
                .name("lfen-protocol".into())
                .spawn(move || loop {
                    let job = {
                        let guard = rx.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                        guard.recv()
                    };
                    match job {
                        Ok(job) => job(),
                        // 发送端全部释放 = 池关闭（进程退出），worker 随之收尾。
                        Err(_) => break,
                    }
                })
                .expect("协议工作线程启动不可失败");
        }
        tx
    })
}

/// 把一个协议供给任务投递进工作线程池——调用线程（可能是 UI 线程）立即返回，不阻塞。
pub(crate) fn dispatch(job: impl FnOnce() + Send + 'static) {
    // 发送失败仅发生在池已关闭（进程退出）——此时请求本就无从响应，丢弃即可。
    let _ = sender().send(Box::new(job));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    /// 核心性能契约：任务在 worker 线程执行（非调用线程），且 dispatch 不等待任务完成。
    #[test]
    fn dispatch_runs_off_caller_thread_and_returns_immediately() {
        let caller = thread::current().id();
        let (done_tx, done_rx) = mpsc::channel::<thread::ThreadId>();
        dispatch(move || {
            // 刻意停留一拍：若 dispatch 同步等待，下面的 try_recv 必然已收到完成信号。
            thread::sleep(Duration::from_millis(50));
            let _ = done_tx.send(thread::current().id());
        });
        // dispatch 已返回而任务尚未完成 = 调用线程未被阻塞。
        assert!(
            done_rx.try_recv().is_err(),
            "dispatch 不应等待任务完成（阻塞了调用线程）"
        );
        let worker = done_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("worker 应在限时内交付");
        assert_ne!(worker, caller, "任务必须在 worker 线程执行，而非调用线程");
    }

    /// 池有多 worker：WORKERS 个互相等待的任务能同时推进（单线程池会在此死锁）。
    #[test]
    fn pool_runs_jobs_concurrently() {
        let (tx, rx) = mpsc::channel::<usize>();
        let barrier = Arc::new(std::sync::Barrier::new(WORKERS));
        for i in 0..WORKERS {
            let tx = tx.clone();
            let barrier = Arc::clone(&barrier);
            dispatch(move || {
                // 每个任务到齐才放行：只有 WORKERS 个任务真并行，屏障才不会超时。
                barrier.wait();
                let _ = tx.send(i);
            });
        }
        drop(tx);
        let mut got = std::collections::BTreeSet::new();
        for _ in 0..WORKERS {
            got.insert(
                rx.recv_timeout(Duration::from_secs(5))
                    .expect("并发任务应在限时内全部完成（单线程池会死锁）"),
            );
        }
        assert_eq!(got.len(), WORKERS);
    }

    /// 源面守卫：lfstream 注册必须是异步协议 + 线程池投递 + responder 交付。
    /// 回退同步注册会把解密拉回 UI 线程（性能契约破坏），此守卫红。
    #[test]
    fn lfstream_registration_is_async_and_dispatched_to_pool() {
        let lib = include_str!("lib.rs");
        assert!(
            lib.contains("register_asynchronous_uri_scheme_protocol(\"lfstream\""),
            "lfstream 必须用异步协议注册（同步版在 UI 线程执行处理器）"
        );
        assert!(
            lib.contains("protocol_pool::dispatch"),
            "协议供给必须投递进工作线程池"
        );
        assert!(
            lib.contains("responder.respond(response)"),
            "响应必须经异步 responder 从 worker 线程交付"
        );
    }
}