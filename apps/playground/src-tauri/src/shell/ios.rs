//! iOS 方向落地：objc2 直调 UIKit，不经 Swift 插件。
//!
//! **为什么不用原生插件**：Tauri 的 iOS 插件在 iOS 侧就是 Swift 实现，引入插件只是把
//! Swift 搬进别人的仓，本仓仍要链接 Swift 包。方向能力只有两个 UIKit 入口——
//! `supportedInterfaceOrientations` 与 `UIWindowScene.requestGeometryUpdate`——直接用
//! objc2 调即可。
//!
//! **平台语义**：`requestGeometryUpdate` 只是**一次性旋转请求**，请求后玩家物理旋转仍会
//! 改变方向；持续锁定必须让 view controller 持续报出受限的允许集合。Tauri 的 iOS 模板
//! 没有可编辑的 AppDelegate（入口 `main.mm`，delegate 在生成的 tauri-api 包内），故在
//! 运行期给 webview 的 VC 换一个动态子类来覆写方向方法（isa-swizzling，非私有 API）。
//!
//! **iPad**：默认开启多任务时方向锁被系统忽略（Apple 规则：声明支持全部方向 = 必须支持
//! 多任务）。本实现不声明 `UIRequiresFullScreen`（那会永久失去分屏，与「三态可切换」
//! 相悖），iPad 上锁定为尽力而为，未生效由宿主如实记录诊断。

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
use objc2::{available, ffi, AnyThread, MainThreadMarker};
use objc2_foundation::{NSNumber, NSObjectNSKeyValueCoding, NSString};
use objc2_ui_kit::{
    UIApplication, UIDevice, UIInterfaceOrientation, UIInterfaceOrientationMask, UIViewController,
    UIWindowScene, UIWindowSceneGeometryPreferences, UIWindowSceneGeometryPreferencesIOS,
};
use std::ffi::{c_void, CStr};
use std::sync::atomic::{AtomicUsize, Ordering};

use super::OrientationMode;

/// 方向状态的单一事实源：动态子类上报的允许集合与几何更新请求都读它。
///
/// 用原子量而非全局可变引用：覆写方法的调用时机由 UIKit 决定（可能早于/晚于
/// `set_orientation`），读端只需要一个无锁快照。
static MASK: AtomicUsize = AtomicUsize::new(UIInterfaceOrientationMask::AllButUpsideDown.0);

impl OrientationMode {
    /// 三态 → UIKit 允许集合。auto 取 iPhone 的默认集合（不含倒竖），与 plist 缺省声明一致。
    fn ui_mask(self) -> UIInterfaceOrientationMask {
        match self {
            OrientationMode::Auto => UIInterfaceOrientationMask::AllButUpsideDown,
            OrientationMode::Portrait => UIInterfaceOrientationMask::Portrait,
            OrientationMode::Landscape => UIInterfaceOrientationMask::Landscape,
        }
    }
}

/// 覆写 `supportedInterfaceOrientations`：每次询问都回当前允许集合（持续锁定的关键）。
extern "C-unwind" fn supported_orientations(
    _this: *mut UIViewController,
    _cmd: Sel,
) -> UIInterfaceOrientationMask {
    UIInterfaceOrientationMask(MASK.load(Ordering::Relaxed))
}

/// 覆写 `shouldAutorotate`：始终允许系统按当前集合旋转（集合本身已受限）。
extern "C-unwind" fn should_autorotate(_this: *mut UIViewController, _cmd: Sel) -> Bool {
    Bool::YES
}

/// 给 VC 换动态子类（幂等：同名类已存在则复用，同一 VC 已换过则直接返回）。
///
/// 返回是否处于已注入状态；`false` 表示无法创建子类（基类不可用等），调用方按
/// 「未生效」处理而不是报错。
fn install_override(vc: &UIViewController) -> bool {
    /// 动态子类名前缀。类名本身不可重复注册，故「是否已注入」按前缀判定——
    /// 若改用「当前类名 == 派生名」比较，注入后当前类名已带前缀，会再派生一层
    /// 子类（ObjC 类永不释放），每次切换方向都叠一层。
    const PREFIX: &str = "LingFanOrientation_";

    let obj: *mut AnyObject = (vc as *const UIViewController).cast_mut().cast();
    let Some(base_ptr) = std::ptr::NonNull::new(unsafe { ffi::object_getClass(obj) }.cast_mut())
    else {
        return false;
    };
    let base: &AnyClass = unsafe { base_ptr.as_ref() };
    let base_name = unsafe { CStr::from_ptr(ffi::object_getClassName(obj)) }.to_string_lossy();
    if base_name.starts_with(PREFIX) {
        return true;
    }
    // 类名按基类派生：VC 类不同（系统版本间会变）时不复用错类
    let Ok(name) = std::ffi::CString::new(format!("{PREFIX}{}", base_name.replace('.', "_")))
    else {
        return false;
    };
    let cls: &'static AnyClass =
        match std::ptr::NonNull::new(unsafe { ffi::objc_lookUpClass(name.as_ptr()) }.cast_mut()) {
            Some(existing) => unsafe { existing.as_ref() },
            None => {
                let Some(mut builder) = ClassBuilder::new(&name, base) else {
                    return false;
                };
                let mask_imp: extern "C-unwind" fn(_, _) -> _ = supported_orientations;
                let rotate_imp: extern "C-unwind" fn(_, _) -> _ = should_autorotate;
                unsafe {
                    builder.add_method(objc2::sel!(supportedInterfaceOrientations), mask_imp);
                    builder.add_method(objc2::sel!(shouldAutorotate), rotate_imp);
                }
                builder.register()
            }
        };
    unsafe { ffi::object_setClass(obj, cls) };
    true
}

/// 取承载该 VC 的窗口场景：优先沿视图树（view → window → windowScene），
/// 视图尚未入窗时退回前台场景集合的第一个。
fn window_scene_of(vc: &UIViewController) -> Option<Retained<UIWindowScene>> {
    if let Some(scene) = vc
        .view()
        .and_then(|view| view.window())
        .and_then(|window| window.windowScene())
    {
        return Some(scene);
    }
    let mtm = MainThreadMarker::new()?;
    let scenes = UIApplication::sharedApplication(mtm).connectedScenes();
    let first = scenes.anyObject()?;
    Some(unsafe { Retained::cast_unchecked::<UIWindowScene>(first) })
}

/// iOS 13–15 回退：无几何更新 API，走 KVC 改设备方向 + 请求一次旋转。
///
/// 仅在 < 16 执行——`attemptRotationToDeviceOrientation` 自 16 起弃用。
fn rotate_legacy(mask: UIInterfaceOrientationMask) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let target = if mask == UIInterfaceOrientationMask::Portrait {
        UIInterfaceOrientation::Portrait
    } else {
        UIInterfaceOrientation::LandscapeRight
    };
    let value = NSNumber::numberWithInteger(target.0);
    let key = NSString::from_str("orientation");
    let device = UIDevice::currentDevice(mtm);
    let number: &AnyObject = unsafe { &*(Retained::as_ptr(&value) as *const AnyObject) };
    unsafe { device.setValue_forKey(Some(number), &key) };
    #[allow(deprecated)]
    UIViewController::attemptRotationToDeviceOrientation(mtm);
}

/// 应用方向：先确保允许集合被覆写，再请求一次几何更新（16+）或旧 API（< 16）。
fn apply_mask(vc: &UIViewController, mask: UIInterfaceOrientationMask) {
    vc.setNeedsUpdateOfSupportedInterfaceOrientations();
    if available!(ios = 16.0) {
        let Some(scene) = window_scene_of(vc) else {
            return;
        };
        let preferences: Retained<UIWindowSceneGeometryPreferencesIOS> =
            UIWindowSceneGeometryPreferencesIOS::initWithInterfaceOrientations(
                UIWindowSceneGeometryPreferencesIOS::alloc(),
                mask,
            );
        let base: &UIWindowSceneGeometryPreferences = &preferences;
        // 错误回调传 None：拒绝原因只影响「本次是否转了」，不影响持续锁定，故不拦
        scene.requestGeometryUpdateWithPreferences_errorHandler(base, None);
        return;
    }
    // auto 不强制旋转，只释放约束（回到系统的自动旋转）
    if mask != UIInterfaceOrientationMask::AllButUpsideDown {
        rotate_legacy(mask);
    }
}

/// 视图树诊断：方向与渲染问题共用一条证据链（0×0 或缺失 = 尺寸/层级问题；
/// 满屏而画面空白 = DOM/CSS 渲染问题）。
fn log_view_tree(vc: &UIViewController) {
    let Some(view) = vc.view() else {
        eprintln!("[lfen] orientation vc=no-view");
        return;
    };
    let frame = view.frame();
    eprintln!(
        "[lfen] orientation frame={}x{}+{}+{} subviews={}",
        frame.size.width,
        frame.size.height,
        frame.origin.x,
        frame.origin.y,
        view.subviews().len()
    );
}

/// 入口：在 `with_webview` 闭包内（主线程）应用方向，结果经 `tx` 回传命令侧。
///
/// `vc_ptr` 来自 `PlatformWebview::view_controller()`；空指针按「未生效」处理——
/// 窗口尚未建好时该句柄可能为空，不视为错误。
pub fn apply(
    vc_ptr: *mut c_void,
    mode: OrientationMode,
    tx: std::sync::mpsc::Sender<Result<(), String>>,
) {
    let Some(vc) = std::ptr::NonNull::new(vc_ptr.cast::<UIViewController>()) else {
        let _ = tx.send(Err("视图控制器不可用".to_string()));
        return;
    };
    let vc: &UIViewController = unsafe { vc.as_ref() };
    let mask = mode.ui_mask();
    MASK.store(mask.0, Ordering::Relaxed);
    if !install_override(vc) {
        let _ = tx.send(Err("方向覆写注入失败（无法创建动态子类）".to_string()));
        return;
    }
    log_view_tree(vc);
    apply_mask(vc, mask);
    let _ = tx.send(Ok(()));
}
