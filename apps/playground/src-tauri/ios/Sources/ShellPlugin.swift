//
//  08 §八.2 屏幕方向（iOS 原生落点）：Rust `shell::set_orientation` 的实现。
//
//  **放置**：本文件是仓库内暂存副本——首次在 macOS 上执行 `pnpm tauri ios init` 生成
//  `src-tauri/gen/apple/` 之后，复制到 `src-tauri/gen/apple/Sources/<app.name>/` 即可
//  （XcodeGen 的 `sources: - path: Sources` 自动纳入编译，无需改 project.yml）。
//  **状态：未经编译验证**（需 macOS + Xcode；API 签名依据 Tauri 2.11 源码
//  `tauri::ios_plugin_binding!` → `swift!(fn init_plugin_x() -> *const c_void)` 与官方 iOS 插件文档）。
//
//  平台语义（与 Android 的「持续锁定」不同，见规约 08 §八.3）：
//  - `requestGeometryUpdate` 只是**一次性旋转请求**：请求后玩家物理旋转仍会改变方向；
//    持续锁定必须让 view controller 持续报出受限的 `supportedInterfaceOrientations`；
//  - Tauri 的 iOS 模板没有可编辑的 AppDelegate（入口 main.mm，delegate 在生成的 tauri-api 包内），
//    故用运行时 isa-swizzling 给 webview 的 VC 换一个动态子类来覆写方向方法（非私有 API）；
//  - iPad 默认开启多任务时方向锁被系统忽略（Apple 规则：声明支持全部方向 = 必须支持多任务）。
//    本实现**不**声明 UIRequiresFullScreen（那会永久失去分屏，与「三态可切换」相悖），
//    iPad 上锁定为尽力而为；未生效由宿主如实记录诊断（`applied` 语义）。
//

import Foundation
import ObjectiveC
import SwiftRs
import Tauri
import UIKit
import WebKit

/// Invoke 参数（iOS 侧为 Decodable；不支持下默认值，可选参数须写 `var x: T?`）
class SetOrientationArgs: Decodable {
  let mode: String
}

/// 方向状态单一事实源：动态子类上报的方向集合与几何更新请求都读它
enum OrientationState {
  /// auto = 跟随系统与用户自动旋转（allButUpsideDown = iPhone 默认集合，不含倒竖）
  static var mask: UIInterfaceOrientationMask = .allButUpsideDown
}

class ShellPlugin: Plugin {
  /// 已注入动态子类的 VC（幂等：同一 VC 只注入一次）
  private weak var injected: UIViewController?
  private var injectedClass: AnyClass?

  @objc public func setOrientation(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetOrientationArgs.self)
    let mask: UIInterfaceOrientationMask
    switch args.mode {
    case "auto":
      mask = .allButUpsideDown
    case "portrait":
      mask = .portrait
    case "landscape":
      mask = .landscape
    default:
      invoke.reject("不支持的屏幕方向模式：\(args.mode)")
      return
    }
    OrientationState.mask = mask
    DispatchQueue.main.async { [weak self] in
      guard let viewController = self?.manager.viewController else {
        invoke.reject("视图控制器不可用")
        return
      }
      #if DEBUG
        // 白屏类问题的决定性证据：WebView 的 view 尺寸与子视图树（0×0 / 缺失 = 尺寸或层级问题；
        // 满屏而画面空白 = DOM/CSS 渲染问题）。随 os_log 带出，无需下载产物即可判读。
        let subviews = viewController.view.subviews.map {
          "\(type(of: $0))[\(NSCoder.string(for: $0.frame))]"
        }.joined(separator: " ")
        NSLog(
          "[lfen] orientation mode=%@ vc=%@ viewFrame=%@ bounds=%@ subviews(%d): %@",
          args.mode,
          String(describing: type(of: viewController)),
          NSCoder.string(for: viewController.view.frame),
          NSCoder.string(for: viewController.view.bounds),
          viewController.view.subviews.count,
          subviews
        )
      #endif
      self?.installOrientationOverride(on: viewController)
      self?.applyMask(mask, on: viewController)
      invoke.resolve(["applied": true])
    }
  }

  /// 运行时注入：给 VC 换动态子类，覆写 supportedInterfaceOrientations / shouldAutorotate
  private func installOrientationOverride(on viewController: UIViewController) {
    if injected === viewController, let injectedClass,
      object_getClass(viewController) === injectedClass
    {
      return
    }
    let base: AnyClass = type(of: viewController)
    let name = "LingFanOrientation_\(NSStringFromClass(base).replacingOccurrences(of: ".", with: "_"))"
    let dynamic: AnyClass
    if let existing = objc_lookUpClass(name) {
      dynamic = existing
    } else {
      guard let created = objc_allocateClassPair(base, name, 0) else { return }
      let maskBlock: @convention(block) (AnyObject) -> UIInterfaceOrientationMask = { _ in
        OrientationState.mask
      }
      let rotateBlock: @convention(block) (AnyObject) -> Bool = { _ in true }
      replaceMethod(
        in: created, selector: #selector(getter: UIViewController.supportedInterfaceOrientations),
        block: unsafeBitCast(maskBlock, to: AnyObject.self))
      replaceMethod(
        in: created, selector: #selector(getter: UIViewController.shouldAutorotate),
        block: unsafeBitCast(rotateBlock, to: AnyObject.self))
      objc_registerClassPair(created)
      dynamic = created
    }
    object_setClass(viewController, dynamic)
    injected = viewController
    injectedClass = dynamic
  }

  /// 复用既有方法的类型编码替换实现（避免手写编码串出错）
  private func replaceMethod(in cls: AnyClass, selector: Selector, block: AnyObject) {
    guard
      let method = class_getInstanceMethod(cls, selector)
        ?? class_getInstanceMethod(UIViewController.self, selector),
      let types = method_getTypeEncoding(method)
    else { return }
    class_replaceMethod(cls, selector, imp_implementationWithBlock(block), types)
  }

  /// 应用方向：iOS 16+ 走几何更新（并通知受支持集合变化）；<16 走旧 API（仅回退路径）
  private func applyMask(_ mask: UIInterfaceOrientationMask, on viewController: UIViewController) {
    if #available(iOS 16.0, *) {
      viewController.setNeedsUpdateOfSupportedInterfaceOrientations()
      viewController.navigationController?.setNeedsUpdateOfSupportedInterfaceOrientations()
      if let scene = viewController.view.window?.windowScene
        ?? UIApplication.shared.connectedScenes.first as? UIWindowScene
      {
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { error in
          NSLog("[orientation] 几何更新被拒：%@", error.localizedDescription)
        }
      }
      return
    }
    // iOS 13–15：无几何更新 API，走旧 API（16 起已弃用，故只在 <16 设备执行）
    guard mask != .allButUpsideDown else { return }  // auto 不强制旋转，仅释放约束
    let target: UIInterfaceOrientation = mask == .portrait ? .portrait : .landscapeRight
    UIDevice.current.setValue(target.rawValue, forKey: "orientation")
    UIViewController.attemptRotationToDeviceOrientation()
  }
}

/// Rust 侧 `tauri::ios_plugin_binding!(init_plugin_shell)` 的 C 入口（返回插件对象指针）
@_cdecl("init_plugin_shell")
func initPlugin() -> Plugin {
  return ShellPlugin()
}
