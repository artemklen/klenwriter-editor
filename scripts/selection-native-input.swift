// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed selection fixture input. No arbitrary app, URL, keys, eval or screen coordinates.
import Foundation
import AppKit
import ApplicationServices

let began = DispatchTime.now().uptimeNanoseconds
var posted = false
func elapsed() -> Double { Double(DispatchTime.now().uptimeNanoseconds - began) / 1_000_000 }
func emit(_ value: [String: Any], _ code: Int32) -> Never {
    let bytes = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(bytes); FileHandle.standardOutput.write(Data([10])); exit(code)
}
func refuse(_ reason: String) -> Never {
    emit(["status": "refused", "reason": reason, "delivery": posted ? "unknown/may_have_sent" : "not_sent", "elapsedMs": elapsed()], 2)
}
func closed(_ value: [String: Any], _ keys: Set<String>) -> Bool { Set(value.keys) == keys }
func number(_ value: Any?) -> Double? {
    guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
    return n.doubleValue
}
func boolean(_ value: Any?) -> Bool? {
    guard let n = value as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
    return n.boolValue
}
func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name, &value) == .success ? value : nil
}
func title(_ element: AXUIElement) -> String? { attribute(element, kAXTitleAttribute as CFString) as? String }
func rectangle(_ element: AXUIElement) -> CGRect? {
    guard let p = attribute(element, kAXPositionAttribute as CFString), CFGetTypeID(p) == AXValueGetTypeID(),
          let s = attribute(element, kAXSizeAttribute as CFString), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var origin = CGPoint.zero, size = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &origin), AXValueGetValue(s as! AXValue, .cgSize, &size),
          origin.x.isFinite, origin.y.isFinite, size.width.isFinite, size.height.isFinite,
          (origin.x + size.width).isFinite, (origin.y + size.height).isFinite,
          size.width > 0, size.height > 0 else { return nil }
    return CGRect(origin: origin, size: size)
}
func webViewport(_ window: AXUIElement) -> (view: CGRect, visited: Int, depth: Int)? {
    var todo: [(AXUIElement, Int)] = [(window, 0)], seen: [AXUIElement] = [], matches: [CGRect] = []
    var maximumDepth = 0
    while let (element, depth) = todo.popLast() {
        if seen.contains(where: { CFEqual($0, element) }) { continue }
        guard seen.count < 512, depth <= 32 else { return nil }; seen.append(element)
        maximumDepth = max(maximumDepth, depth)
        if attribute(element, kAXRoleAttribute as CFString) as? String == "AXWebArea",
           let r = rectangle(element), abs(r.width - 1024) <= 0.5, abs(r.height - 768) <= 0.5 { matches.append(r) }
        if let children = attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] {
            guard children.count <= 512 - seen.count - todo.count else { return nil }
            for child in children.reversed() { todo.append((child, depth + 1)) }
        }
    }
    return matches.count == 1 ? (matches[0], seen.count, maximumDepth) : nil
}
struct WindowMeasurement {
    let front: NSRunningApplication
    let application: AXUIElement
    let window: AXUIElement
    let view: CGRect
    let frame: CGRect
    let expectedBundle: String
    let expectedTitle: String
    let windowCount: Int
    let visited: Int
    let depth: Int
    var contained: Bool {
        view.minX >= frame.minX - 0.5 && view.maxX <= frame.maxX + 0.5 &&
        view.minY >= frame.minY - 0.5 && view.maxY <= frame.maxY + 0.5
    }
}
func measureWindow(_ browser: String, _ pageTitle: String) -> WindowMeasurement {
    guard AXIsProcessTrusted() else { refuse("Existing Accessibility permission is unavailable") }
    let bundle = browser == "safari" ? "com.apple.Safari" : "com.google.Chrome"
    let expectedTitle = pageTitle + (browser == "chrome" ? " - Google Chrome" : "")
    guard let front = NSWorkspace.shared.frontmostApplication, front.bundleIdentifier == bundle else { refuse("Fixture browser is not frontmost") }
    let application = AXUIElementCreateApplication(front.processIdentifier)
    guard let windows = attribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement], windows.count <= 32 else { refuse("Bounded browser AX windows unavailable") }
    let matching = windows.filter { title($0) == expectedTitle }
    guard matching.count == 1, let focused = attribute(application, kAXFocusedWindowAttribute as CFString),
          CFGetTypeID(focused) == AXUIElementGetTypeID(), CFEqual(focused, matching[0]) else { refuse("Exact unique fixture title is not focused") }
    guard let scan = webViewport(matching[0]), let frame = rectangle(matching[0]) else { refuse("Unique frozen AXWebArea viewport unavailable") }
    return WindowMeasurement(front: front, application: application, window: matching[0], view: scan.view, frame: frame,
        expectedBundle: bundle, expectedTitle: expectedTitle, windowCount: windows.count, visited: scan.visited, depth: scan.depth)
}
func recheckWindow(_ measurement: WindowMeasurement, _ deadline: Double) -> String {
    guard elapsed() < deadline,
          NSWorkspace.shared.frontmostApplication?.processIdentifier == measurement.front.processIdentifier,
          let focused = attribute(measurement.application, kAXFocusedWindowAttribute as CFString),
          CFGetTypeID(focused) == AXUIElementGetTypeID(), CFEqual(focused, measurement.window),
          let observedTitle = title(measurement.window), observedTitle == measurement.expectedTitle else { refuse("Fixture guard expired or ownership changed before post") }
    return observedTitle
}
func encodedRectangle(_ value: CGRect) -> [String: Double] {
    ["x": value.minX, "y": value.minY, "width": value.width, "height": value.height]
}
let argv = CommandLine.arguments
if argv.count == 3 && argv[1] == "--inspect-window" {
    guard let data = argv[2].data(using: .utf8), data.count <= 4096,
          let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          closed(request, ["format", "browser", "nonce", "title", "fixtureUrl", "deadlineMs"]),
          request["format"] as? String == "osr40-native-window-inspection/1", request["browser"] as? String == "chrome",
          let nonce = request["nonce"] as? String, nonce.utf8.count == 32,
          nonce.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
          let pageTitle = request["title"] as? String, pageTitle == "KlenWriter Selection native " + nonce,
          request["fixtureUrl"] as? String == "http://127.0.0.1:4174/selection",
          let deadline = number(request["deadlineMs"]), deadline >= 1, deadline <= 1000 else { refuse("Invalid closed window inspection request") }
    let measurement = measureWindow("chrome", pageTitle)
    let observedTitle = recheckWindow(measurement, deadline)
    guard elapsed() <= deadline else { refuse("Window inspection deadline expired") }
    emit(["format": "osr40-native-window-inspection/1", "status": "inspected", "delivery": "not_sent",
        "browser": "chrome", "nonce": nonce, "title": pageTitle, "fixtureUrl": "http://127.0.0.1:4174/selection",
        "frontBundle": measurement.expectedBundle, "frontPid": measurement.front.processIdentifier,
        "expectedAxWindowTitle": measurement.expectedTitle, "observedAxWindowTitle": observedTitle,
        "axWindowCount": measurement.windowCount, "axMatchCount": 1, "visitedNodes": measurement.visited, "maximumDepth": measurement.depth,
        "axWindow": encodedRectangle(measurement.frame), "axViewport": encodedRectangle(measurement.view),
        "contained": measurement.contained, "elapsedMs": elapsed()], 0)
}
guard argv.count == 3, ["--request", "--guard-key"].contains(argv[1]), let data = argv[2].data(using: .utf8), data.count <= 4096,
      let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      closed(request, ["format", "browser", "nonce", "title", "fixtureUrl", "mountedId", "requestId", "serial", "caseId", "action", "target", "point", "viewport", "pointerDown", "cleanupOnly", "deadlineMs", "mouseFrom"]),
      request["format"] as? String == "osr40-native-input/1",
      let browser = request["browser"] as? String, ["chrome", "safari"].contains(browser),
      let nonce = request["nonce"] as? String, nonce.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
      let expectedTitle = request["title"] as? String, expectedTitle == "KlenWriter Selection native " + nonce,
      request["fixtureUrl"] as? String == "http://127.0.0.1:4174/selection",
      let mount = request["mountedId"] as? String, mount.range(of: "^selection-mount-[1-9][0-9]{0,8}$", options: .regularExpression) != nil,
      let requestId = request["requestId"] as? String, requestId.range(of: "^" + nonce + ":[1-9][0-9]{0,3}$", options: .regularExpression) != nil,
      let serial = number(request["serial"]), serial >= 1, serial <= 1024, serial.rounded() == serial,
      let action = request["action"] as? String,
      ["move-start", "down", "move-end", "up", "shift-left", "select-all", "copy", "cut", "shift-tab", "tab"].contains(action),
      let caseId = request["caseId"] as? String,
      ["key-comb", "key-zwj", "key-flag", "key-rtl", "key-select-all", "mouse-forward", "mouse-reverse", "scroll-down-terminal", "scroll-up-terminal", "scroll-down-active", "scroll-up-active", "scroll-down-focus", "scroll-up-focus"].contains(caseId),
      let target = request["target"] as? String,
      let held = boolean(request["pointerDown"]), let cleanup = boolean(request["cleanupOnly"]),
      let deadline = number(request["deadlineMs"]), deadline >= 1, deadline <= 1000,
      let viewport = request["viewport"] as? [String: Any], closed(viewport, ["width", "height", "scale", "offsetLeft", "offsetTop"]),
      number(viewport["width"]) == 1024, number(viewport["height"]) == 768, number(viewport["scale"]) == 1,
      number(viewport["offsetLeft"]) == 0, number(viewport["offsetTop"]) == 0 else { refuse("Invalid closed selection request") }
guard target == (action == "tab" ? "host-control" : "editor") || action == "up" && held && target == "host-control",
      !cleanup || action == "up" && held else { refuse("Target or cleanup transition differs") }
let mouse = ["move-start", "down", "move-end", "up"].contains(action)
let guardingKey = argv[1] == "--guard-key"
guard guardingKey ? !mouse : mouse else { refuse("Input mode does not match its closed mouse/key action") }
var point: CGPoint?
if mouse {
    guard let value = request["point"] as? [String: Any], closed(value, ["x", "y"]),
          let x = number(value["x"]), let y = number(value["y"]), x >= 0, x < 1024, y >= 0, y < 768 else { refuse("Invalid fixed client point") }
    point = CGPoint(x: x, y: y)
} else if !(request["point"] is NSNull) { refuse("Key cannot carry screen coordinates") }
var fromScreen: CGPoint?, fromViewport: CGRect?
if action == "move-end" {
    guard let value = request["mouseFrom"] as? [String: Any], closed(value, ["screenPoint", "axViewport"]),
          let screen = value["screenPoint"] as? [String: Any], closed(screen, ["x", "y"]),
          let x = number(screen["x"]), let y = number(screen["y"]),
          let bounds = value["axViewport"] as? [String: Any], closed(bounds, ["x", "y", "width", "height"]),
          let vx = number(bounds["x"]), let vy = number(bounds["y"]),
          let width = number(bounds["width"]), let height = number(bounds["height"]),
          abs(width - 1024) <= 0.5, abs(height - 768) <= 0.5,
          (vx + width).isFinite, (vy + height).isFinite, (vx + 1024).isFinite, (vy + 768).isFinite,
          x >= vx, x < vx + 1024, y >= vy, y < vy + 768 else { refuse("Invalid owned mouse movement origin") }
    fromScreen = CGPoint(x: x, y: y); fromViewport = CGRect(x: vx, y: vy, width: width, height: height)
} else if !(request["mouseFrom"] is NSNull) { refuse("Only held movement can carry its owned origin") }
guard action != "down" || !held, action != "move-start" || !held,
      action != "move-end" || held, action != "up" || held,
      mouse || action == "shift-tab" || !held else { refuse("Pointer transition differs") }
let measurement = measureWindow(browser, expectedTitle)
guard measurement.contained else { refuse("Unique frozen AXWebArea viewport unavailable") }
let observedAxWindowTitle = recheckWindow(measurement, deadline)
let view = measurement.view
if let previous = fromViewport {
    guard previous == view else { refuse("Owned mouse AX viewport changed before movement") }
}
var result: [String: Any] = ["action": action, "nonce": nonce, "requestId": requestId,
    "mountedId": mount, "caseId": caseId, "target": target, "cleanupOnly": cleanup,
    "frontBundle": measurement.expectedBundle, "frontPid": measurement.front.processIdentifier,
    "expectedAxWindowTitle": measurement.expectedTitle, "observedAxWindowTitle": observedAxWindowTitle,
    "axWindowCount": measurement.windowCount, "axViewport": encodedRectangle(view)]
if guardingKey {
    guard elapsed() <= deadline else { refuse("Key guard deadline expired") }
    result["status"] = "guarded"; result["delivery"] = "not_sent"; result["elapsedMs"] = elapsed()
    result["method"] = "read-only strict AX key preflight; no key posted"
    emit(result, 0)
}
guard let local = point else { refuse("Mouse input lacks its fixed client point") }
let actual = CGPoint(x: view.minX + local.x, y: view.minY + local.y)
let type: CGEventType = action == "down" ? .leftMouseDown : action == "up" ? .leftMouseUp : action == "move-end" ? .leftMouseDragged : .mouseMoved
guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: actual, mouseButton: .left) else { refuse("Cannot allocate fixture mouse event") }
if action == "down" || action == "up" { event.setIntegerValueField(.mouseEventClickState, value: 1) }
if let previous = fromScreen {
    // Integer relative metadata uses nearest rounding, with exact half values away from zero.
    // The authoritative absolute fixture location remains unchanged.
    event.setIntegerValueField(.mouseEventDeltaX, value: Int64((actual.x - previous.x).rounded(.toNearestOrAwayFromZero)))
    event.setIntegerValueField(.mouseEventDeltaY, value: Int64((actual.y - previous.y).rounded(.toNearestOrAwayFromZero)))
}
result["mouseEvent"] = ["type": event.type.rawValue, "location": ["x": event.location.x, "y": event.location.y],
    "deltaX": event.getIntegerValueField(.mouseEventDeltaX), "deltaY": event.getIntegerValueField(.mouseEventDeltaY),
    "clickState": event.getIntegerValueField(.mouseEventClickState), "pressure": event.getDoubleValueField(.mouseEventPressure)]
posted = true; event.post(tap: .cghidEventTap)
guard elapsed() <= deadline else { refuse("Fixture guard expired during post") }
result["status"] = "sent"; result["elapsedMs"] = elapsed()
result["method"] = "fixture-scoped CGEvent mouse; platform input, not hardware-device provenance"
result["screenPoint"] = ["x": actual.x, "y": actual.y]
emit(result, 0)
