// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed UI42 fixture input. No arbitrary app, URL, keys, eval or screen coordinates.
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
func webViewport(_ window: AXUIElement, _ expectedWidth: Double, _ expectedHeight: Double) -> (view: CGRect, visited: Int, depth: Int)? {
    var todo: [(AXUIElement, Int)] = [(window, 0)], seen: [AXUIElement] = [], matches: [CGRect] = []
    var maximumDepth = 0
    while let (element, depth) = todo.popLast() {
        if seen.contains(where: { CFEqual($0, element) }) { continue }
        guard seen.count < 512, depth <= 32 else { return nil }; seen.append(element)
        maximumDepth = max(maximumDepth, depth)
        if attribute(element, kAXRoleAttribute as CFString) as? String == "AXWebArea",
           let r = rectangle(element), abs(r.width - expectedWidth) <= 2, abs(r.height - expectedHeight) <= 2 { matches.append(r) }
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
func measureWindow(_ browser: String, _ pageTitle: String, _ expectedWidth: Double = 1024, _ expectedHeight: Double = 768) -> WindowMeasurement {
    guard AXIsProcessTrusted() else { refuse("Existing Accessibility permission is unavailable") }
    let bundle = browser == "safari" ? "com.apple.Safari" : "com.google.Chrome"
    let expectedTitle = pageTitle + (browser == "chrome" ? " - Google Chrome" : "")
    guard let front = NSWorkspace.shared.frontmostApplication, front.bundleIdentifier == bundle else { refuse("Fixture browser is not frontmost") }
    let application = AXUIElementCreateApplication(front.processIdentifier)
    guard let windows = attribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement], windows.count <= 32 else { refuse("Bounded browser AX windows unavailable") }
    let matching = windows.filter { title($0) == expectedTitle }
    guard matching.count == 1, let focused = attribute(application, kAXFocusedWindowAttribute as CFString),
          CFGetTypeID(focused) == AXUIElementGetTypeID(), CFEqual(focused, matching[0]) else { refuse("Exact unique fixture title is not focused") }
    guard let scan = webViewport(matching[0], expectedWidth, expectedHeight), let frame = rectangle(matching[0]) else { refuse("Unique measured AXWebArea viewport unavailable") }
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
// Explicit Chrome Find-window proof. Never supplies a WebArea or pointer map.
struct ChromeFindWindowMeasurement {
    let root: AXUIElement
    let frame: CGRect
    let auxiliary: AXUIElement?
    let auxiliaryFrame: CGRect?
    let phase: String
}
func findRequestFrame(_ value: Any?) -> CGRect? {
    guard let fields = value as? [String: Any], closed(fields, ["x", "y", "width", "height"]),
          let x = number(fields["x"]), let y = number(fields["y"]),
          let width = number(fields["width"]), let height = number(fields["height"]),
          width > 0, height > 0, (x + width).isFinite, (y + height).isFinite else { return nil }
    return CGRect(x: x, y: y, width: width, height: height)
}
func measureChromeFindWindow(_ pid: pid_t, _ pageTitle: String, _ originalFrame: CGRect,
                             _ allowClosed: Bool, _ deadline: Double) -> ChromeFindWindowMeasurement {
    guard elapsed() < deadline, AXIsProcessTrusted() else { refuse("Find-window authority expired or Accessibility unavailable") }
    guard let front = NSWorkspace.shared.frontmostApplication, front.processIdentifier == pid,
          front.bundleIdentifier == "com.google.Chrome", front.localizedName == "Google Chrome" else { refuse("Original Chrome Find process is not frontmost") }
    let application = AXUIElementCreateApplication(pid)
    guard let windows = attribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement],
          windows.count == 2 || (allowClosed && windows.count == 1) else { refuse("Closed Chrome Find window count differs") }
    let rootTitle = pageTitle + " - Google Chrome"
    let roots = windows.filter { title($0) == rootTitle }
    guard roots.count == 1, let root = roots.first,
          attribute(root, kAXRoleAttribute as CFString) as? String == "AXWindow",
          attribute(root, kAXSubroleAttribute as CFString) as? String == "AXStandardWindow",
          let frame = rectangle(root), frame == originalFrame,
          let focused = attribute(application, kAXFocusedWindowAttribute as CFString),
          CFGetTypeID(focused) == AXUIElementGetTypeID(), CFEqual(focused, root) else { refuse("Original Chrome Find root, frame or focused object differs") }
    if windows.count == 1 {
        return ChromeFindWindowMeasurement(root: root, frame: frame, auxiliary: nil, auxiliaryFrame: nil, phase: "closed")
    }
    let other = windows.filter { !CFEqual($0, root) }
    let auxiliaryTitle = "Find in page\n    " + pageTitle
    guard other.count == 1, let auxiliary = other.first,
          title(auxiliary) == auxiliaryTitle,
          attribute(auxiliary, kAXRoleAttribute as CFString) as? String == "AXWindow",
          attribute(auxiliary, kAXSubroleAttribute as CFString) as? String == "AXUnknown",
          let auxiliaryFrame = rectangle(auxiliary),
          auxiliaryFrame.minX >= frame.minX, auxiliaryFrame.maxX <= frame.maxX,
          auxiliaryFrame.minY >= frame.minY, auxiliaryFrame.maxY <= frame.maxY else { refuse("Exact contained nonce Chrome Find auxiliary differs") }
    return ChromeFindWindowMeasurement(root: root, frame: frame, auxiliary: auxiliary, auxiliaryFrame: auxiliaryFrame, phase: "open")
}
func findWholeMatch(_ value: String, _ pattern: String) -> Bool {
    guard let match = value.range(of: pattern, options: .regularExpression) else { return false }
    return match == (value.startIndex..<value.endIndex)
}
func inspectChromeFindWindow(_ mode: String, _ json: String) -> Never {
    guard let data = json.data(using: .utf8), data.count <= 4096,
          let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          closed(request, ["format", "browser", "nonce", "title", "fixtureUrl", "mountedId", "caseId", "findRequestId", "requestId", "serial", "pid", "rootFrame", "purpose", "deadlineMs"]),
          request["format"] as? String == "osr42-chrome-find-window/1", request["browser"] as? String == "chrome",
          let nonce = request["nonce"] as? String, nonce.utf8.count == 32, nonce.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
          let pageTitle = request["title"] as? String, pageTitle == "KlenWriter UI native " + nonce,
          request["fixtureUrl"] as? String == "http://127.0.0.1:4174/ui", request["caseId"] as? String == "modes-zoom",
          let mount = request["mountedId"] as? String, findWholeMatch(mount, "^ui42-[1-9][0-9]{0,8}$"),
          let findRequestId = request["findRequestId"] as? String, findWholeMatch(findRequestId, "^" + nonce + ":[1-9][0-9]{0,3}$"),
          let requestId = request["requestId"] as? String, findWholeMatch(requestId, "^" + nonce + ":[1-9][0-9]{0,3}$"),
          let serial = number(request["serial"]), serial >= 1, serial <= 2048, serial.rounded() == serial,
          let pidValue = number(request["pid"]), pidValue >= 1, pidValue <= Double(Int32.max), pidValue.rounded() == pidValue,
          let originalFrame = findRequestFrame(request["rootFrame"]),
          let purpose = request["purpose"] as? String,
          (mode == "--inspect-find-window" ? ["post-find", "screenshot"].contains(purpose) : ["pre-close-find", "release-find", "release-close-find"].contains(purpose)),
          let deadline = number(request["deadlineMs"]), deadline >= 1, deadline <= 1000, deadline.rounded() == deadline else { refuse("Invalid closed Chrome Find-window request") }
    guard (purpose == "post-find" ? requestId == findRequestId : requestId != findRequestId) else { refuse("Chrome Find request identity differs") }
    let pid = pid_t(pidValue), allowClosed = purpose == "release-find" || purpose == "release-close-find"
    let first = measureChromeFindWindow(pid, pageTitle, originalFrame, allowClosed, deadline)
    let final = measureChromeFindWindow(pid, pageTitle, originalFrame, allowClosed, deadline)
    guard elapsed() <= deadline, first.phase == final.phase, CFEqual(first.root, final.root), first.frame == final.frame else { refuse("Chrome Find ownership changed during proof") }
    if let firstAuxiliary = first.auxiliary {
        guard let finalAuxiliary = final.auxiliary, CFEqual(firstAuxiliary, finalAuxiliary),
              first.auxiliaryFrame == final.auxiliaryFrame else { refuse("Chrome Find auxiliary changed during proof") }
    }
    let rootTitle = pageTitle + " - Google Chrome"
    var auxiliary: Any = NSNull()
    if let frame = final.auxiliaryFrame {
        auxiliary = ["title": "Find in page\n    " + pageTitle, "role": "AXWindow", "subrole": "AXUnknown", "frame": encodedRectangle(frame)] as [String: Any]
    }
    emit(["format": "osr42-chrome-find-window/1", "status": mode == "--guard-find-key" ? "guarded" : "inspected", "delivery": "not_sent",
          "measurement": "native-find-window-only", "purpose": purpose, "browser": "chrome", "nonce": nonce, "title": pageTitle,
          "fixtureUrl": "http://127.0.0.1:4174/ui", "mountedId": mount, "caseId": "modes-zoom", "findRequestId": findRequestId,
          "requestId": requestId, "serial": serial, "frontPid": pid, "frontBundle": "com.google.Chrome",
          "expectedAxWindowTitle": rootTitle, "observedAxWindowTitle": rootTitle, "axWindowCount": final.phase == "open" ? 2 : 1,
          "axWindow": encodedRectangle(final.frame), "rootFocused": true, "rootRole": "AXWindow", "rootSubrole": "AXStandardWindow",
          "findAux": auxiliary, "contained": true, "elapsedMs": elapsed(), "nativeFindPhase": final.phase], 0)
}

let argv = CommandLine.arguments
if argv.count == 3 && ["--inspect-find-window", "--guard-find-key"].contains(argv[1]) {
    inspectChromeFindWindow(argv[1], argv[2])
}
if argv.count == 3 && argv[1] == "--inspect-window" {
    guard let data = argv[2].data(using: .utf8), data.count <= 4096,
          let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          (closed(request, ["format", "browser", "nonce", "title", "fixtureUrl", "deadlineMs"]) || closed(request, ["format", "browser", "nonce", "title", "fixtureUrl", "deadlineMs", "viewport"])),
          request["format"] as? String == "osr42-native-window-inspection/1", let browser = request["browser"] as? String, ["chrome", "safari"].contains(browser),
          let nonce = request["nonce"] as? String, nonce.utf8.count == 32,
          nonce.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
          let pageTitle = request["title"] as? String, pageTitle == "KlenWriter UI native " + nonce,
          request["fixtureUrl"] as? String == "http://127.0.0.1:4174/ui",
          let deadline = number(request["deadlineMs"]), deadline >= 1, deadline <= 1000 else { refuse("Invalid closed window inspection request") }
    var width = 1024.0, height = 768.0
    if let viewport = request["viewport"] as? [String: Any] {
        guard closed(viewport, ["width", "height", "scale", "offsetLeft", "offsetTop", "pageZoom"]),
              let w = number(viewport["width"]), let h = number(viewport["height"]), let zoom = number(viewport["pageZoom"]),
              w > 0, h > 0, zoom >= 1, zoom <= 2, abs(w * zoom - 1024) <= 2, h * zoom >= 480, h * zoom <= 770,
              number(viewport["scale"]) == 1, number(viewport["offsetLeft"]) == 0, number(viewport["offsetTop"]) == 0 else { refuse("Invalid measured screenshot viewport") }
        width = w * zoom; height = h * zoom
    } else if request["viewport"] != nil { refuse("Malformed screenshot viewport") }
    let measurement = measureWindow(browser, pageTitle, width, height)
    let observedTitle = recheckWindow(measurement, deadline)
    guard elapsed() <= deadline else { refuse("Window inspection deadline expired") }
    emit(["format": "osr42-native-window-inspection/1", "status": "inspected", "delivery": "not_sent",
        "browser": browser, "nonce": nonce, "title": pageTitle, "fixtureUrl": "http://127.0.0.1:4174/ui",
        "frontBundle": measurement.expectedBundle, "frontPid": measurement.front.processIdentifier,
        "expectedAxWindowTitle": measurement.expectedTitle, "observedAxWindowTitle": observedTitle,
        "axWindowCount": measurement.windowCount, "axMatchCount": 1, "visitedNodes": measurement.visited, "maximumDepth": measurement.depth,
        "axWindow": encodedRectangle(measurement.frame), "axViewport": encodedRectangle(measurement.view),
        "contained": measurement.contained, "elapsedMs": elapsed()], 0)
}
guard argv.count == 3, ["--request", "--guard-key"].contains(argv[1]), let data = argv[2].data(using: .utf8), data.count <= 4096,
 let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
 closed(request, ["format", "browser", "nonce", "title", "fixtureUrl", "mountedId", "requestId", "serial", "caseId", "action", "target", "point", "viewport", "pointerDown", "cleanupOnly", "deadlineMs"]),
 request["format"] as? String == "osr42-native-input/1",
 let browser = request["browser"] as? String, ["chrome", "safari"].contains(browser),
 let nonce = request["nonce"] as? String, nonce.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
 let expectedTitle = request["title"] as? String, expectedTitle == "KlenWriter UI native " + nonce,
 request["fixtureUrl"] as? String == "http://127.0.0.1:4174/ui",
 let mount = request["mountedId"] as? String, mount.range(of: "^ui42-[1-9][0-9]{0,8}$", options: .regularExpression) != nil,
 let requestId = request["requestId"] as? String, requestId.range(of: "^" + nonce + ":[1-9][0-9]{0,3}$", options: .regularExpression) != nil,
 let serial = number(request["serial"]), serial >= 1, serial <= 2048, serial.rounded() == serial,
 let action = request["action"] as? String,
 let caseId = request["caseId"] as? String,
 ["navigation", "format-keyboard", "format-pointer", "add-keyboard", "add-pointer", "move-menu-up", "move-menu-down", "move-key-up", "move-key-down", "host-dialog", "composition-format", "composition-move", "composition-add", "composition-dialog", "modes-zoom"].contains(caseId),
 let target = request["target"] as? String,
 let held = boolean(request["pointerDown"]), let cleanup = boolean(request["cleanupOnly"]),
 let deadline = number(request["deadlineMs"]), deadline >= 1, deadline <= 1000,
 let viewport = request["viewport"] as? [String: Any], closed(viewport, ["width", "height", "scale", "offsetLeft", "offsetTop", "pageZoom"]),
 let width = number(viewport["width"]), let height = number(viewport["height"]), let zoom = number(viewport["pageZoom"]),
 width >= 1, width <= 1024, height >= 1, height <= 768, zoom >= 1, zoom <= 2,
 abs(width * zoom - 1024) <= 2, height * zoom >= 480, height * zoom <= 770,
 number(viewport["scale"]) == 1, number(viewport["offsetLeft"]) == 0, number(viewport["offsetTop"]) == 0 else { refuse("Invalid closed UI42 request") }
let pointerTargets = ["click-strong":"strong", "click-add":"add", "click-paragraph":"paragraph", "click-move":"move", "click-up":"up", "click-down":"down", "click-nest":"nest", "click-title":"title", "click-cancel":"cancel", "click-recovery":"recovery"]
let keys = ["tab", "shift-tab", "left", "right", "up", "down", "home", "end", "enter", "space", "escape", "move-up", "move-down", "copy", "find", "close-find", "zoom-in", "zoom-reset", "ordinary-en", "ordinary-ru", "deadkey-acute", "complete-e"]
let pointer = pointerTargets[action] != nil
let guardingKey = argv[1] == "--guard-key"
guard pointer ? !guardingKey && target == pointerTargets[action] : guardingKey && keys.contains(action) && target == "focused",
 cleanup ? (pointer ? held : !held) : !held else { refuse("Closed action/target transition differs") }
let measurement = measureWindow(browser, expectedTitle, width * zoom, height * zoom)
guard measurement.contained else { refuse("Owned AX viewport must be contained") }
let observed = recheckWindow(measurement, deadline)
var result: [String: Any] = ["action":action, "nonce":nonce, "requestId":requestId, "mountedId":mount, "caseId":caseId, "target":target,
 "cleanupOnly":cleanup, "frontBundle":measurement.expectedBundle, "frontPid":measurement.front.processIdentifier,
 "expectedAxWindowTitle":measurement.expectedTitle, "observedAxWindowTitle":observed, "axWindowCount":measurement.windowCount,
 "axViewport":encodedRectangle(measurement.view), "axWindow":encodedRectangle(measurement.frame)]
if guardingKey {
 guard request["point"] is NSNull, elapsed() <= deadline else { refuse("Key cannot carry coordinates or expired authority") }
 result["status"]="guarded"; result["delivery"]="not_sent"; result["elapsedMs"]=elapsed(); emit(result,0)
}
guard let p = request["point"] as? [String:Any], closed(p,["x","y"]), let x=number(p["x"]), let y=number(p["y"]), x>=0, x<width, y>=0, y<height else { refuse("Closed target point outside actual viewport") }
let actual=CGPoint(x:measurement.view.minX+x*measurement.view.width/width,y:measurement.view.minY+y*measurement.view.height/height)
guard actual.x.isFinite, actual.y.isFinite else { refuse("Finite scoped screen point required") }
let transitions: [CGEventType] = cleanup ? [.leftMouseUp] : [.leftMouseDown,.leftMouseUp]
for type in transitions {
 _=recheckWindow(measurement,deadline)
 guard let event=CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:actual,mouseButton:.left) else { refuse("Cannot allocate scoped pointer event") }
 event.setIntegerValueField(.mouseEventClickState,value:1);posted=true;event.post(tap:.cghidEventTap)
}
guard elapsed() <= deadline else { refuse("Pointer completion exceeded authority deadline") }
result["status"]="sent";result["delivery"]="sent";result["screenPoint"]=["x":actual.x,"y":actual.y];result["transitions"]=cleanup ? ["up"] : ["down","up"];result["elapsedMs"]=elapsed()
result["method"]="exact fixture control point via CGEvent; platform input, not hardware-device provenance";emit(result,0)
