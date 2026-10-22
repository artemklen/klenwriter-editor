// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed Slash43 fixture input. No arbitrary app, URL, keys, eval or screen coordinates.
import Foundation
import AppKit
import ApplicationServices
import Carbon

let began = DispatchTime.now().uptimeNanoseconds
var posted = false
var safariScrollRecheckProofs: [[String: Any]] = []
func elapsed() -> Double { Double(DispatchTime.now().uptimeNanoseconds - began) / 1_000_000 }
func emit(_ value: [String: Any], _ code: Int32) -> Never {
    var output = value
    if var proof = output["axViewportProof"] as? [String: Any] {
        proof["rechecks"] = safariScrollRecheckProofs
        output["axViewportProof"] = proof
    }
    let bytes = try! JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
    FileHandle.standardOutput.write(bytes); FileHandle.standardOutput.write(Data([10])); exit(code)
}
func refuse(_ reason: String, viewportDiagnostic: [String: Any]? = nil) -> Never {
    var output: [String: Any] = ["status": "refused", "reason": reason, "delivery": posted ? "unknown/may_have_sent" : "not_sent", "elapsedMs": elapsed()]
    if let viewportDiagnostic = viewportDiagnostic { output["viewportDiagnostic"] = viewportDiagnostic }
    emit(output, 2)
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
// BEGIN SAFARI_SCROLL_VIEWPORT_GEOMETRY
func safariScrollViewportGeometry(root: CGRect, scroll: CGRect, content: CGRect, verticalScrollbar: CGRect?, scrollbarOrientation: String?, expectedWidth: Double, expectedHeight: Double) -> CGRect? {
    func valid(_ r: CGRect) -> Bool {
        r.origin.x.isFinite && r.origin.y.isFinite && r.size.width.isFinite && r.size.height.isFinite
            && r.size.width > 0 && r.size.height > 0
            && (r.origin.x + r.size.width).isFinite && (r.origin.y + r.size.height).isFinite
    }
    guard valid(root), valid(scroll), valid(content), expectedWidth.isFinite, expectedHeight.isFinite,
          expectedWidth > 0, expectedHeight > 0,
          abs(scroll.width - expectedWidth) <= 2, abs(scroll.height - expectedHeight) <= 2,
          scroll.minX >= root.minX - 0.5, scroll.maxX <= root.maxX + 0.5,
          scroll.minY >= root.minY - 0.5, scroll.maxY <= root.maxY + 0.5,
          abs(content.minX - scroll.minX) <= 0.5, content.minY <= scroll.minY + 0.5,
          content.maxY >= scroll.maxY - 0.5 else { return nil }
    let gap = scroll.maxX - content.maxX
    guard gap >= 0, gap <= 32 else { return nil }
    if let bar = verticalScrollbar {
        guard valid(bar), scrollbarOrientation == "AXVerticalOrientation" else { return nil }
        if gap > 0 {
            guard abs(bar.minX - content.maxX) <= 0.5, abs(bar.width - gap) <= 0.5,
                  abs(bar.maxX - scroll.maxX) <= 0.5 else { return nil }
        }
    } else if gap > 0 || scrollbarOrientation != nil { return nil }
    let left = max(content.minX, scroll.minX), top = max(content.minY, scroll.minY)
    let right = min(content.maxX, scroll.maxX), bottom = min(content.maxY, scroll.maxY)
    guard right > left, bottom > top else { return nil }
    return CGRect(x: left, y: top, width: right - left, height: bottom - top)
}
func safariScrollViewportPoint(viewport: CGRect, visible: CGRect, cssWidth: Double, cssHeight: Double, x: Double?, y: Double?) -> CGPoint? {
    func valid(_ r: CGRect) -> Bool {
        r.origin.x.isFinite && r.origin.y.isFinite && r.size.width.isFinite && r.size.height.isFinite
            && r.size.width > 0 && r.size.height > 0
            && (r.origin.x + r.size.width).isFinite && (r.origin.y + r.size.height).isFinite
    }
    guard valid(viewport), valid(visible), cssWidth.isFinite, cssHeight.isFinite, cssWidth > 0, cssHeight > 0,
          let x = x, let y = y, x.isFinite, y.isFinite, x >= 0, x < cssWidth, y >= 0, y < cssHeight,
          visible.minX >= viewport.minX, visible.maxX <= viewport.maxX,
          visible.minY >= viewport.minY, visible.maxY <= viewport.maxY else { return nil }
    let point = CGPoint(x: viewport.minX + x * viewport.width / cssWidth, y: viewport.minY + y * viewport.height / cssHeight)
    guard point.x.isFinite, point.y.isFinite, point.x >= visible.minX, point.x < visible.maxX,
          point.y >= visible.minY, point.y < visible.maxY else { return nil }
    return point
}
// END SAFARI_SCROLL_VIEWPORT_GEOMETRY

struct SafariScrollViewport {
    let contentElement: AXUIElement
    let scrollElement: AXUIElement
    let barElement: AXUIElement?
    let content: CGRect
    let scroll: CGRect
    let bar: CGRect?
    let orientation: String?
    let visible: CGRect
    let expectedWidth: Double
    let expectedHeight: Double
    var proof: [String: Any] {
        var scrollbar: Any = NSNull()
        if let bar = bar { scrollbar = ["role": "AXScrollBar", "orientation": orientation as Any? ?? NSNull(), "frame": encodedRectangle(bar)] as [String: Any] }
        return ["basis": "safari-scroll-viewport", "content": encodedRectangle(content), "scrollArea": encodedRectangle(scroll),
                "visibleContent": encodedRectangle(visible), "scrollBar": scrollbar,
                "totalWebAreas": 1, "oldExactWebAreaMatches": 0, "genuineDirectParent": true]
    }
}
struct SafariViewportScan {
    let view: CGRect
    let visited: Int
    let depth: Int
    let fallback: SafariScrollViewport?
}
// Same complete CFEqual-bounded walk; fallback never follows an incomplete scan.
func safariViewport(_ window: AXUIElement, _ rootFrame: CGRect, _ expectedWidth: Double, _ expectedHeight: Double) -> SafariViewportScan? {
    var todo: [(AXUIElement, Int, AXUIElement?)] = [(window, 0, nil)], seen: [AXUIElement] = [], exact: [CGRect] = []
    var webAreas: [(AXUIElement, AXUIElement?)] = [], maximumDepth = 0, complete = true
    while let (element, depth, parent) = todo.popLast() {
        if seen.contains(where: { CFEqual($0, element) }) { continue }
        guard seen.count < 512, depth <= 32 else { return nil }
        seen.append(element); maximumDepth = max(maximumDepth, depth)
        let role = attribute(element, kAXRoleAttribute as CFString) as? String
        if role == nil { complete = false }
        if role == "AXWebArea" {
            webAreas.append((element, parent))
            if let r = rectangle(element), abs(r.width - expectedWidth) <= 2, abs(r.height - expectedHeight) <= 2 { exact.append(r) }
        }
        var rawChildren: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &rawChildren)
        if status == .success, let children = rawChildren as? [AXUIElement] {
            guard children.count <= 512 - seen.count - todo.count else { return nil }
            for child in children.reversed() { todo.append((child, depth + 1, element)) }
        } else if status != .attributeUnsupported && status != .noValue { complete = false }
    }
    if exact.count == 1 { return SafariViewportScan(view: exact[0], visited: seen.count, depth: maximumDepth, fallback: nil) }
    guard exact.isEmpty, complete, webAreas.count == 1, let parent = webAreas[0].1,
          attribute(parent, kAXRoleAttribute as CFString) as? String == "AXScrollArea",
          let actualParent = attribute(webAreas[0].0, kAXParentAttribute as CFString), CFGetTypeID(actualParent) == AXUIElementGetTypeID(), CFEqual(actualParent, parent),
          let children = attribute(parent, kAXChildrenAttribute as CFString) as? [AXUIElement], children.count <= 512,
          children.filter({ CFEqual($0, webAreas[0].0) }).count == 1,
          let content = rectangle(webAreas[0].0), let scroll = rectangle(parent) else { return nil }
    let bars = children.filter { attribute($0, kAXRoleAttribute as CFString) as? String == "AXScrollBar" }
    guard bars.count <= 1 else { return nil }
    var bar: CGRect?, orientation: String?
    if let element = bars.first {
        guard let actualParent = attribute(element, kAXParentAttribute as CFString), CFGetTypeID(actualParent) == AXUIElementGetTypeID(), CFEqual(actualParent, parent),
              let rect = rectangle(element), let direction = attribute(element, kAXOrientationAttribute as CFString) as? String,
              direction == "AXVerticalOrientation" else { return nil }
        bar = rect; orientation = direction
    }
    guard let visible = safariScrollViewportGeometry(root: rootFrame, scroll: scroll, content: content, verticalScrollbar: bar,
        scrollbarOrientation: orientation, expectedWidth: expectedWidth, expectedHeight: expectedHeight) else { return nil }
    let fallback = SafariScrollViewport(contentElement: webAreas[0].0, scrollElement: parent, barElement: bars.first,
        content: content, scroll: scroll, bar: bar, orientation: orientation, visible: visible, expectedWidth: expectedWidth, expectedHeight: expectedHeight)
    return SafariViewportScan(view: scroll, visited: seen.count, depth: maximumDepth, fallback: fallback)
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
    let safariScroll: SafariScrollViewport?
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
    if browser == "safari" {
        guard let frame = rectangle(matching[0]), let scan = safariViewport(matching[0], frame, expectedWidth, expectedHeight) else { refuse("Unique measured AXWebArea viewport unavailable") }
        return WindowMeasurement(front: front, application: application, window: matching[0], view: scan.view, frame: frame,
            expectedBundle: bundle, expectedTitle: expectedTitle, windowCount: windows.count, visited: scan.visited, depth: scan.depth, safariScroll: scan.fallback)
    }
    guard let scan = webViewport(matching[0], expectedWidth, expectedHeight), let frame = rectangle(matching[0]) else { refuse("Unique measured AXWebArea viewport unavailable") }
    return WindowMeasurement(front: front, application: application, window: matching[0], view: scan.view, frame: frame,
        expectedBundle: bundle, expectedTitle: expectedTitle, windowCount: windows.count, visited: scan.visited, depth: scan.depth, safariScroll: nil)
}
func recheckWindow(_ measurement: WindowMeasurement, _ deadline: Double) -> String {
    guard elapsed() < deadline,
          NSWorkspace.shared.frontmostApplication?.processIdentifier == measurement.front.processIdentifier,
          let focused = attribute(measurement.application, kAXFocusedWindowAttribute as CFString),
          CFGetTypeID(focused) == AXUIElementGetTypeID(), CFEqual(focused, measurement.window),
          let observedTitle = title(measurement.window), observedTitle == measurement.expectedTitle else { refuse("Fixture guard expired or ownership changed before post") }
    if let saved = measurement.safariScroll {
        guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.Safari",
              let windows = attribute(measurement.application, kAXWindowsAttribute as CFString) as? [AXUIElement], windows.count <= 32 else { refuse("Original Safari scroll viewport changed before post") }
        let matching = windows.filter { title($0) == measurement.expectedTitle }
        guard matching.count == 1, CFEqual(matching[0], measurement.window),
              let frame = rectangle(measurement.window), frame == measurement.frame,
              let scan = safariViewport(measurement.window, frame, saved.expectedWidth, saved.expectedHeight), let current = scan.fallback,
              CFEqual(saved.contentElement, current.contentElement), CFEqual(saved.scrollElement, current.scrollElement),
              saved.scroll == current.scroll, saved.bar == current.bar,
              saved.orientation == current.orientation, saved.visible == current.visible else { refuse("Original Safari scroll viewport changed before post") }
        // The full current content geometry was validated above. Its extent
        // outside the unchanged visible clip is not a coordinate authority.
        if let bar = saved.barElement {
            guard let currentBar = current.barElement, CFEqual(bar, currentBar) else { refuse("Original Safari scrollbar identity changed before post") }
        } else if current.barElement != nil { refuse("Original Safari scrollbar membership changed before post") }
        guard elapsed() < deadline, NSWorkspace.shared.frontmostApplication?.processIdentifier == measurement.front.processIdentifier,
              let focused = attribute(measurement.application, kAXFocusedWindowAttribute as CFString), CFGetTypeID(focused) == AXUIElementGetTypeID(),
              CFEqual(focused, measurement.window), title(measurement.window) == measurement.expectedTitle,
              rectangle(measurement.window) == measurement.frame else { refuse("Safari scroll viewport authority expired before post") }
        guard safariScrollRecheckProofs.count < 3 else { refuse("Safari scroll viewport recheck bound") }
        safariScrollRecheckProofs.append(current.proof)
    }
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
          request["format"] as? String == "osr43-chrome-find-window/1", request["browser"] as? String == "chrome",
          let nonce = request["nonce"] as? String, nonce.utf8.count == 32, nonce.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
          let pageTitle = request["title"] as? String, pageTitle == "KlenWriter Slash native " + nonce,
          request["fixtureUrl"] as? String == "http://127.0.0.1:4174/ui", let caseId = request["caseId"] as? String, ["I43-N05-en", "I43-N05-ru"].contains(caseId),
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
    emit(["format": "osr43-chrome-find-window/1", "status": mode == "--guard-find-key" ? "guarded" : "inspected", "delivery": "not_sent",
          "measurement": "native-find-window-only", "purpose": purpose, "browser": "chrome", "nonce": nonce, "title": pageTitle,
          "fixtureUrl": "http://127.0.0.1:4174/ui", "mountedId": mount, "caseId": caseId, "findRequestId": findRequestId,
          "requestId": requestId, "serial": serial, "frontPid": pid, "frontBundle": "com.google.Chrome",
          "expectedAxWindowTitle": rootTitle, "observedAxWindowTitle": rootTitle, "axWindowCount": final.phase == "open" ? 2 : 1,
          "axWindow": encodedRectangle(final.frame), "rootFocused": true, "rootRole": "AXWindow", "rootSubrole": "AXStandardWindow",
          "findAux": auxiliary, "contained": true, "elapsedMs": elapsed(), "nativeFindPhase": final.phase], 0)
}

// Read-only fixed alphabet proof. This is not delivery or layout-selection authority.
func keyboardLiteralProof(_ action: String) -> [String: Any]? {
    let literals: [String: (String, UInt16, UInt32, String)] = ["slash": ("com.apple.keylayout.US", 44, 0, "/"), "query-p": ("com.apple.keylayout.US", 35, 0, "p"), "query-a": ("com.apple.keylayout.US", 0, 0, "a"), "query-r": ("com.apple.keylayout.US", 15, 0, "r"), "query-ru-w": ("com.apple.keylayout.Russian", 13, 0, "ц"), "query-ru-b": ("com.apple.keylayout.Russian", 11, 0, "и"), "query-ru-n": ("com.apple.keylayout.Russian", 45, 0, "т"), "ordinary-en": ("com.apple.keylayout.US", 6, 2, "Z"), "ordinary-ru": ("com.apple.keylayout.Russian", 6, 0, "я"), "complete-e": ("com.apple.keylayout.US", 14, 0, "e")]
    guard let literal = literals[action] else { return nil }
    func raw(_ source: TISInputSource, _ key: CFString) -> UnsafeMutableRawPointer? { TISGetInputSourceProperty(source, key) }
    func sourceId(_ source: TISInputSource) -> String? {
        guard let p = raw(source, kTISPropertyInputSourceID) else { return nil }
        return Unmanaged<CFString>.fromOpaque(p).takeUnretainedValue() as String
    }
    func flag(_ source: TISInputSource, _ key: CFString) -> Bool {
        guard let p = raw(source, key) else { return false }
        return CFBooleanGetValue(Unmanaged<CFBoolean>.fromOpaque(p).takeUnretainedValue())
    }
    let selected = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
    let layout = TISCopyCurrentKeyboardLayoutInputSource().takeRetainedValue()
    guard sourceId(selected) == literal.0, sourceId(layout) == literal.0,
          flag(selected, kTISPropertyInputSourceIsSelected), flag(selected, kTISPropertyInputSourceIsEnabled),
          flag(selected, kTISPropertyInputSourceIsSelectCapable),
          let opaque = raw(layout, kTISPropertyUnicodeKeyLayoutData) else { refuse("Exact selected fixed keyboard source unavailable") }
    let data = Unmanaged<CFData>.fromOpaque(opaque).takeUnretainedValue()
    guard CFDataGetLength(data) > 0, let bytes = CFDataGetBytePtr(data) else { refuse("Fixed Unicode layout unavailable") }
    let keyboard = UnsafeRawPointer(bytes).assumingMemoryBound(to: UCKeyboardLayout.self)
    let keyboardType = UInt32(LMGetKbdType())
    var state: UInt32 = 0, length: Int = 0
    var characters = [UniChar](repeating: 0, count: 8)
    let status = characters.withUnsafeMutableBufferPointer { buffer in
        UCKeyTranslate(keyboard, literal.1, UInt16(kUCKeyActionDown), literal.2, keyboardType,
                       OptionBits(0), &state, buffer.count, &length, buffer.baseAddress!)
    }
    guard status == noErr, state == 0, length > 0, length <= characters.count else { refuse("Fixed keyboard translation refused") }
    let text = String(utf16CodeUnits: characters, count: Int(length))
    guard text == literal.3 else { refuse("Fixed keyboard translation differs from source-authored literal") }
    // Re-read actual selected identity after translation; no layout or preferences are changed.
    let final = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
    let finalLayout = TISCopyCurrentKeyboardLayoutInputSource().takeRetainedValue()
    guard sourceId(final) == literal.0, sourceId(finalLayout) == literal.0,
          flag(final, kTISPropertyInputSourceIsSelected), flag(final, kTISPropertyInputSourceIsEnabled),
          flag(final, kTISPropertyInputSourceIsSelectCapable) else { refuse("Fixed keyboard source changed during proof") }
    return ["sourceId": literal.0, "layoutId": literal.0, "selected": true, "enabled": true, "selectable": true,
            "keyCode": literal.1, "modifierState": literal.2, "keyboardType": keyboardType,
            "text": text, "deadKeyState": state, "osStatus": status]
}

let argv = CommandLine.arguments
if argv.count == 3 && ["--inspect-find-window", "--guard-find-key"].contains(argv[1]) {
    inspectChromeFindWindow(argv[1], argv[2])
}
if argv.count == 3 && argv[1] == "--inspect-window" {
    guard let data = argv[2].data(using: .utf8), data.count <= 4096,
          let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          (closed(request, ["format", "browser", "nonce", "title", "fixtureUrl", "deadlineMs"]) || closed(request, ["format", "browser", "nonce", "title", "fixtureUrl", "deadlineMs", "viewport"])),
          request["format"] as? String == "osr43-native-window-inspection/1", let browser = request["browser"] as? String, ["chrome", "safari"].contains(browser),
          let nonce = request["nonce"] as? String, nonce.utf8.count == 32,
          nonce.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
          let pageTitle = request["title"] as? String, pageTitle == "KlenWriter Slash native " + nonce,
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
    var inspection: [String: Any] = ["format": "osr43-native-window-inspection/1", "status": "inspected", "delivery": "not_sent",
        "browser": browser, "nonce": nonce, "title": pageTitle, "fixtureUrl": "http://127.0.0.1:4174/ui",
        "frontBundle": measurement.expectedBundle, "frontPid": measurement.front.processIdentifier,
        "expectedAxWindowTitle": measurement.expectedTitle, "observedAxWindowTitle": observedTitle,
        "axWindowCount": measurement.windowCount, "axMatchCount": 1, "visitedNodes": measurement.visited, "maximumDepth": measurement.depth,
        "axWindow": encodedRectangle(measurement.frame), "axViewport": encodedRectangle(measurement.view),
        "contained": measurement.contained, "elapsedMs": elapsed()]
    if let fallback = measurement.safariScroll { inspection["axViewportProof"] = fallback.proof }
    emit(inspection, 0)
}
let baseInputKeys: Set<String> = ["format", "browser", "nonce", "title", "fixtureUrl", "mountedId", "requestId", "serial", "caseId", "action", "target", "point", "viewport", "pointerDown", "cleanupOnly", "deadlineMs"]
guard argv.count == 3, ["--request", "--guard-key"].contains(argv[1]), let data = argv[2].data(using: .utf8), data.count <= 4096,
 let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
 (closed(request, baseInputKeys) || closed(request, baseInputKeys.union(["pid"]))),
 request["format"] as? String == "osr43-native-input/1",
 let browser = request["browser"] as? String, ["chrome", "safari"].contains(browser),
 let nonce = request["nonce"] as? String, nonce.range(of: "^[a-f0-9]{32}$", options: .regularExpression) != nil,
 let expectedTitle = request["title"] as? String, expectedTitle == "KlenWriter Slash native " + nonce,
 request["fixtureUrl"] as? String == "http://127.0.0.1:4174/ui",
 let mount = request["mountedId"] as? String, mount.range(of: "^ui42-[1-9][0-9]{0,8}$", options: .regularExpression) != nil,
 let requestId = request["requestId"] as? String, requestId.range(of: "^" + nonce + ":[1-9][0-9]{0,3}$", options: .regularExpression) != nil,
 let serial = number(request["serial"]), serial >= 1, serial <= 2048, serial.rounded() == serial,
 let action = request["action"] as? String,
 let caseId = request["caseId"] as? String,
 ["I43-N01-en","I43-N02-en","I43-N03-en","I43-N04-en","I43-N05-en","I43-N06-en","I43-N07-en","I43-N08-en","I43-N09-en","I43-N10-en","I43-N01-ru","I43-N02-ru","I43-N03-ru","I43-N04-ru","I43-N05-ru","I43-N06-ru","I43-N07-ru","I43-N08-ru","I43-N09-ru","I43-N10-ru"].contains(caseId),
 let target = request["target"] as? String,
 let held = boolean(request["pointerDown"]), let cleanup = boolean(request["cleanupOnly"]),
 let deadline = number(request["deadlineMs"]), deadline >= 1, deadline <= (browser == "safari" && argv[1] == "--guard-key" ? 1500 : 1000),
 let viewport = request["viewport"] as? [String: Any], closed(viewport, ["width", "height", "scale", "offsetLeft", "offsetTop", "pageZoom"]),
 let width = number(viewport["width"]), let height = number(viewport["height"]), let zoom = number(viewport["pageZoom"]),
 width >= 1, width <= 1024, height >= 1, height <= 768, zoom >= 1, zoom <= 2,
 abs(width * zoom - 1024) <= 2, height * zoom >= 480, height * zoom <= 770,
 number(viewport["scale"]) == 1, number(viewport["offsetLeft"]) == 0, number(viewport["offsetTop"]) == 0 else { refuse("Invalid closed Slash43 request") }
let allowedCaseActions: [String: [String]] = ["I43-N01-en": ["slash", "query-p", "query-a", "query-r", "enter"], "I43-N02-en": ["slash", "click-quote"], "I43-N03-en": ["slash", "query-p", "query-a", "query-r", "escape", "ordinary-en"], "I43-N04-en": ["slash", "tab", "enter"], "I43-N05-en": ["slash", "ordinary-en", "enter", "find", "close-find"], "I43-N06-en": ["slash", "click-add", "click-recovery"], "I43-N07-en": ["zoom-in", "slash", "up", "down", "escape", "zoom-reset"], "I43-N08-en": ["slash", "deadkey-acute", "complete-e"], "I43-N09-en": ["slash", "deadkey-acute", "click-add", "complete-e"], "I43-N10-en": ["slash", "query-p", "ordinary-ru"], "I43-N01-ru": ["slash", "query-ru-w", "query-ru-b", "query-ru-n", "enter"], "I43-N02-ru": ["slash", "click-quote"], "I43-N03-ru": ["slash", "query-p", "query-a", "query-r", "escape", "ordinary-en"], "I43-N04-ru": ["slash", "tab", "enter"], "I43-N05-ru": ["slash", "ordinary-en", "enter", "find", "close-find"], "I43-N06-ru": ["slash", "click-add", "click-recovery"], "I43-N07-ru": ["zoom-in", "slash", "up", "down", "escape", "zoom-reset"], "I43-N08-ru": ["slash", "deadkey-acute", "complete-e"], "I43-N09-ru": ["slash", "deadkey-acute", "click-add", "complete-e"], "I43-N10-ru": ["slash", "query-p", "ordinary-ru"]]
let pointerTargets = ["click-quote":"quote", "click-add":"add", "click-recovery":"recovery"]
let keys = ["slash","query-p","query-a","query-r","query-ru-w","query-ru-b","query-ru-n","ordinary-en","ordinary-ru","tab","up","down","enter","escape","find","close-find","zoom-in","zoom-reset","deadkey-acute","complete-e"]
guard allowedCaseActions[caseId]?.contains(action) == true else { refuse("Closed43 case/action differs") }
let pointer = pointerTargets[action] != nil
let guardingKey = argv[1] == "--guard-key"
guard pointer ? !guardingKey && target == pointerTargets[action] : guardingKey && keys.contains(action) && target == "focused",
 cleanup ? (pointer ? held : !held) : !held else { refuse("Closed action/target transition differs") }
let postingPid: pid_t?
if browser == "chrome" && pointer {
 guard closed(request, baseInputKeys.union(["pid"])), let pid = number(request["pid"]),
       pid >= 1, pid <= 2147483647, pid.rounded() == pid else { refuse("Original Chrome pointer PID required") }
 postingPid = pid_t(pid)
} else {
 guard closed(request, baseInputKeys) else { refuse("PID is only admitted for Chrome pointers") }
 postingPid = nil
}
let measurement = measureWindow(browser, expectedTitle, width * zoom, height * zoom)
guard measurement.contained else {
    refuse("Owned AX viewport must be contained", viewportDiagnostic: [
        "axWindow": encodedRectangle(measurement.frame), "axViewport": encodedRectangle(measurement.view),
        "viewportSource": measurement.safariScroll == nil ? "exact-web-area" : "safari-scroll-viewport",
        "expectedWidth": width * zoom, "expectedHeight": height * zoom,
        "visitedNodes": measurement.visited, "maximumDepth": measurement.depth
    ])
}
let observed = recheckWindow(measurement, deadline)
var result: [String: Any] = ["action":action, "nonce":nonce, "requestId":requestId, "mountedId":mount, "caseId":caseId, "target":target,
 "cleanupOnly":cleanup, "frontBundle":measurement.expectedBundle, "frontPid":measurement.front.processIdentifier,
 "expectedAxWindowTitle":measurement.expectedTitle, "observedAxWindowTitle":observed, "axWindowCount":measurement.windowCount,
 "axViewport":encodedRectangle(measurement.view), "axWindow":encodedRectangle(measurement.frame)]
if let fallback = measurement.safariScroll { result["axViewportProof"] = fallback.proof }
if guardingKey {
 guard request["point"] is NSNull, elapsed() <= deadline else { refuse("Key cannot carry coordinates or expired authority") }
 if !cleanup, let proof = keyboardLiteralProof(action) { result["keyboardTranslation"] = proof }
 guard elapsed() <= deadline else { refuse("Keyboard translation consumed original deadline") }
 result["status"]="guarded"; result["delivery"]="not_sent"; result["elapsedMs"]=elapsed(); emit(result,0)
}
if let pid = postingPid {
 guard measurement.front.processIdentifier == pid else { refuse("Original Chrome pointer PID differs from guarded owner") }
 let access = CGPreflightPostEventAccess()
 guard access else { refuse("Existing event posting access unavailable") }
 result["posting"] = ["route":"cghidEventTap", "guardedPid":pid, "preflightAccess":access]
}
guard let p = request["point"] as? [String:Any], closed(p,["x","y"]), let x=number(p["x"]), let y=number(p["y"]), x>=0, x<width, y>=0, y<height else { refuse("Closed target point outside actual viewport") }
let actual: CGPoint
if let fallback = measurement.safariScroll {
 guard let point = safariScrollViewportPoint(viewport: fallback.scroll, visible: fallback.visible, cssWidth: width, cssHeight: height, x: x, y: y) else { refuse("Mapped Safari pointer is outside visible WebArea content") }
 actual = point
} else {
 actual=CGPoint(x:measurement.view.minX+x*measurement.view.width/width,y:measurement.view.minY+y*measurement.view.height/height)
}
guard actual.x.isFinite, actual.y.isFinite else { refuse("Finite scoped screen point required") }
let chromePrelude = browser == "chrome" && !cleanup
let transitions: [CGEventType] = cleanup ? [.leftMouseUp] : chromePrelude ? [.mouseMoved,.leftMouseDown,.leftMouseUp] : [.leftMouseDown,.leftMouseUp]
var events: [CGEvent] = []
for type in transitions {
 guard let event=CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:actual,mouseButton:.left) else { refuse("Cannot allocate scoped pointer event") }
 event.setIntegerValueField(.mouseEventClickState,value:type == .mouseMoved ? 0 : 1)
 events.append(event)
}
let constructorTimestamps = chromePrelude ? events.map { $0.timestamp } : []
var pointerPrelude: [String: Any]? = nil
var pairTiming: [String: Any]? = nil
var previousPostUptime: UInt64 = 0
if chromePrelude {
 let downNumber = events[1].getIntegerValueField(.mouseEventNumber)
 events[2].setIntegerValueField(.mouseEventNumber,value:downNumber)
 let upNumber = events[2].getIntegerValueField(.mouseEventNumber)
 guard downNumber == upNumber else { refuse("Allocated Chrome mouse pair number differs") }
 pairTiming = ["timestampPolicy":"constructor-default", "downEventNumber":String(downNumber), "upEventNumber":String(upNumber), "requestedPauseMs":25]
}
for (index, type) in transitions.enumerated() {
 _=recheckWindow(measurement,deadline)
 if let fallback = measurement.safariScroll {
  guard let point = safariScrollViewportPoint(viewport: fallback.scroll, visible: fallback.visible, cssWidth: width, cssHeight: height, x: x, y: y), point == actual else { refuse("Safari pointer no longer belongs to the exact visible content") }
 }
 if chromePrelude {
  let timestamp = events[index].timestamp
  guard timestamp == constructorTimestamps[index] else { refuse("Chrome constructor timestamp changed before post") }
  pairTiming?[["moveTimestampNs","downTimestampNs","upTimestampNs"][index]] = String(timestamp)
  let postUptime = DispatchTime.now().uptimeNanoseconds
  guard postUptime > previousPostUptime else { refuse("Chrome pointer posting clock must increase") }
  previousPostUptime = postUptime
  pairTiming?[["movePostUptimeNs","downPostUptimeNs","upPostUptimeNs"][index]] = String(postUptime)
 }
 posted=true;events[index].post(tap:.cghidEventTap)
 if type == .mouseMoved {
  let pauseBegan = DispatchTime.now().uptimeNanoseconds
  Thread.sleep(forTimeInterval:0.025)
  let pauseElapsed = Double(DispatchTime.now().uptimeNanoseconds - pauseBegan) / 1_000_000
  pointerPrelude = ["event":"mouseMoved", "screenPoint":["x":actual.x,"y":actual.y], "requestedPauseMs":25, "elapsedMs":pauseElapsed]
  _=recheckWindow(measurement,deadline)
 }
 if chromePrelude && type == .leftMouseDown {
  let pauseBegan = DispatchTime.now().uptimeNanoseconds
  Thread.sleep(forTimeInterval:0.025)
  pairTiming?["elapsedMs"] = Double(DispatchTime.now().uptimeNanoseconds - pauseBegan) / 1_000_000
  _=recheckWindow(measurement,deadline)
 }
}
guard elapsed() <= deadline else { refuse("Pointer completion exceeded authority deadline") }
result["status"]="sent";result["delivery"]="sent";result["screenPoint"]=["x":actual.x,"y":actual.y];result["transitions"]=cleanup ? ["up"] : chromePrelude ? ["move","down","up"] : ["down","up"];result["elapsedMs"]=elapsed()
if let prelude = pointerPrelude { result["prelude"] = prelude }
if let timing = pairTiming { result["pairTiming"] = timing }
result["method"]="exact fixture control point via CGEvent; platform input, not hardware-device provenance";emit(result,0)
