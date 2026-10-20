// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed Drag44 fixture input. No arbitrary app, URL, keys, eval or screen coordinates.
import Foundation
import AppKit
import ApplicationServices

let began = DispatchTime.now().uptimeNanoseconds
var posted = false
var completedCore = false
var postedTransitions: [String] = []
var requestEcho: [String: Any] = [:]
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
func refuse(_ reason: String) -> Never {
    var value: [String: Any] = ["status": "refused", "reason": reason, "delivery": posted ? "unknown/may_have_sent" : "not_sent", "elapsedMs": elapsed()]
    if !requestEcho.isEmpty { value["coreComplete"] = completedCore; value["postedTransitions"] = postedTransitions; value["request"] = requestEcho }
    emit(value, 2)
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
        guard safariScrollRecheckProofs.count < 8 else { refuse("Safari scroll viewport recheck bound") }
        safariScrollRecheckProofs.append(current.proof)
    }
    return observedTitle
}
func encodedRectangle(_ value: CGRect) -> [String: Double] {
    ["x": value.minX, "y": value.minY, "width": value.width, "height": value.height]
}

let argv = CommandLine.arguments
func decoded(_ text: String) -> [String: Any]? {
    guard let bytes = text.data(using: .utf8), bytes.count <= 4096 else { return nil }
    return (try? JSONSerialization.jsonObject(with: bytes)) as? [String: Any]
}
func validNamespace(_ r: [String: Any]) -> (String,String,String)? {
    guard let browser=r["browser"] as? String, ["chrome","safari"].contains(browser),
        let nonce=r["nonce"] as? String, nonce.range(of:"^[a-f0-9]{32}$",options:.regularExpression) != nil,
        let t=r["title"] as? String, t == "KlenWriter Drag native " + nonce,
        r["fixtureUrl"] as? String == "http://127.0.0.1:4174/ui" else { return nil }
    return (browser,nonce,t)
}
func viewport(_ v: [String:Any]) -> (Double,Double,Double)? {
    guard closed(v,["width","height","scale","offsetLeft","offsetTop","pageZoom"]),
        let w=number(v["width"]),let h=number(v["height"]),let z=number(v["pageZoom"]),w>0,h>0,z>=1,z<=2.02,
        abs(w*z-1024)<=2,h*z>=480,h*z<=770,number(v["scale"])==1,number(v["offsetLeft"])==0,number(v["offsetTop"])==0 else {return nil}
    return (w,h,z)
}
if argv.count == 3 && argv[1] == "--inspect-window" {
    guard let r=decoded(argv[2]),closed(r,["format","browser","nonce","title","fixtureUrl","deadlineMs"]) || closed(r,["format","browser","nonce","title","fixtureUrl","deadlineMs","viewport"]),
        r["format"] as? String == "osr44-native-window-inspection/1",let (b,n,t)=validNamespace(r),let d=number(r["deadlineMs"]),d>=1,d<=1000 else {refuse("Invalid closed window inspection request")}
    var w=1024.0,h=768.0
    if let raw=r["viewport"] {guard let v=raw as? [String:Any],let (cw,ch,z)=viewport(v) else {refuse("Invalid actual viewport")};w=cw*z;h=ch*z}
    let m=measureWindow(b,t,w,h),observed=recheckWindow(m,d)
    var result:[String:Any] = ["format":"osr44-native-window-inspection/1","status":"inspected","delivery":"not_sent","browser":b,"nonce":n,"title":t,"fixtureUrl":"http://127.0.0.1:4174/ui","frontBundle":m.expectedBundle,"frontPid":m.front.processIdentifier,"expectedAxWindowTitle":m.expectedTitle,"observedAxWindowTitle":observed,"axWindowCount":m.windowCount,"axMatchCount":1,"visitedNodes":m.visited,"maximumDepth":m.depth,"axWindow":encodedRectangle(m.frame),"axViewport":encodedRectangle(m.view),"contained":m.contained,"elapsedMs":elapsed()]
    if let fallback=m.safariScroll {result["axViewportProof"]=fallback.proof};emit(result,0)
}
guard argv.count==3,argv[1]=="--request",let r=decoded(argv[2]),
    closed(r,["format","browser","nonce","title","fixtureUrl","mountedId","requestId","serial","caseId","action","point","viewport","pointerDown","cleanupOnly","deadlineMs","pid","rootFrame","sourceObject","handleObject","targetObject","previousScreenPoint"]),
    r["format"] as? String == "osr44-native-input/1",let (browser,nonce,t)=validNamespace(r),
    let mount=r["mountedId"] as? String,mount.range(of:"^ui42-[1-9][0-9]{0,8}$",options:.regularExpression) != nil,
    let requestId=r["requestId"] as? String,requestId.range(of:"^"+nonce+":"+"[1-9][0-9]{0,8}$",options:.regularExpression) != nil,
    let serial=number(r["serial"]),serial>=1,serial<=2048,serial.rounded()==serial,
    let caseId=r["caseId"] as? String,let action=r["action"] as? String,
    let held=boolean(r["pointerDown"]),let cleanup=boolean(r["cleanupOnly"]),
    let d=number(r["deadlineMs"]),d>=1,d<=1000,let pid=number(r["pid"]),pid>=1,pid<=2147483647,pid.rounded()==pid,
    let rawView=r["viewport"] as? [String:Any],let (w,h,z)=viewport(rawView),
    let root=r["rootFrame"] as? [String:Any],closed(root,["x","y","width","height"]),
    ["x","y","width","height"].allSatisfy({number(root[$0]) != nil}),number(root["width"])! > 0,number(root["height"])! > 0,
    ["sourceObject","handleObject","targetObject"].allSatisfy({key in guard let value=r[key] as? String else{return false};return value.range(of:"^o[1-9][0-9]{0,4}$",options:.regularExpression) != nil}) else {refuse("Invalid closed input request")}
requestEcho=r
let allowed:[String:[String]]=["I44-N01-en": ["hover-source", "move-start", "down", "move-1", "move-2", "move-3", "move-4", "move-5", "move-6", "move-7", "move-8", "up"], "I44-N02-en": ["hover-source", "move-start", "shift-tab", "enter", "down-key"], "I44-N03-en": ["zoom-in", "hover-source", "move-start", "down", "move-1", "move-2", "move-3", "move-4", "move-5", "move-6", "move-7", "move-8", "up", "zoom-reset"], "I44-N04-en": ["hover-source", "move-start", "down", "move-1", "move-2", "move-3", "move-4", "move-5", "move-6", "move-7", "move-8", "right", "up"], "I44-N05-en": ["hover-source", "move-start", "down", "move-1", "move-2", "move-3", "move-4", "move-5", "move-6", "move-7", "move-8", "escape", "up"], "I44-N06-en": ["hover-source", "move-start", "down", "move-1", "move-2", "move-3", "move-4", "move-5", "move-6", "move-7", "move-8", "right", "up"], "I44-N07-en": ["hover-source", "move-start", "down", "move-1", "move-2", "move-3", "move-4", "move-5", "move-6", "move-7", "move-8", "up"], "I44-N08-en": ["hover-source", "move-start", "down", "move-1", "move-2", "move-3", "move-4", "move-5", "move-6", "move-7", "move-8", "up"], "I44-N01-ru": ["hover-source", "move-start", "down", "move-1", "move-2", "move-3", "move-4", "move-5", "move-6", "move-7", "move-8", "up"], "I44-N02-ru": ["hover-source", "move-start", "shift-tab", "enter", "down-key"], "I44-N03-ru": ["zoom-in", "hover-source", "move-start", "down", "move-1", "move-2", "move-3", "move-4", "move-5", "move-6", "move-7", "move-8", "up", "zoom-reset"], "I44-N04-ru": ["hover-source", "move-start", "down", "move-1", "move-2", "move-3", "move-4", "move-5", "move-6", "move-7", "move-8", "right", "up"], "I44-N05-ru": ["hover-source", "move-start", "down", "move-1", "move-2", "move-3", "move-4", "move-5", "move-6", "move-7", "move-8", "escape", "up"], "I44-N06-ru": ["hover-source", "move-start", "down", "move-1", "move-2", "move-3", "move-4", "move-5", "move-6", "move-7", "move-8", "right", "up"], "I44-N07-ru": ["hover-source", "move-start", "down", "move-1", "move-2", "move-3", "move-4", "move-5", "move-6", "move-7", "move-8", "up"], "I44-N08-ru": ["hover-source", "move-start", "down", "move-1", "move-2", "move-3", "move-4", "move-5", "move-6", "move-7", "move-8", "up"]]
guard allowed[caseId]?.contains(action)==true else {refuse("Closed44 case/action differs")}
let pointer=["hover-source","move-start","down","move-1","move-2","move-3","move-4","move-5","move-6","move-7","move-8","up"].contains(action)
let keys:[String:(CGKeyCode,[String])]=["shift-tab":(48,["shift"]),"enter":(36,[]),"down-key":(125,[]),"right":(124,[]),"escape":(53,[]),"zoom-in":(24,["command","shift"]),"zoom-reset":(29,["command"])]
guard pointer || keys[action] != nil else {refuse("Unknown fixed input")}
if pointer {
    guard cleanup ? held && action=="up" : (["hover-source","move-start","down"].contains(action) ? !held : held) else {refuse("Held pointer phase differs")}
} else {guard r["point"] is NSNull,(!held || ["right","escape"].contains(action)) else {refuse("Key point or held key eligibility differs")}}
let m=measureWindow(browser,t,w*z,h*z)
guard m.contained,m.front.processIdentifier==pid_t(pid),
    ["x","y","width","height"].allSatisfy({abs(encodedRectangle(m.frame)[$0]!-number(root[$0])!)<=0.5}) else {refuse("Original PID/root geometry changed")}
_=recheckWindow(m,d)
guard CGPreflightPostEventAccess() else {refuse("Existing event posting access unavailable")}
var result:[String:Any] = ["format":"osr44-native-input-result/1","request":r,"action":action,"nonce":nonce,"requestId":requestId,"mountedId":mount,"caseId":caseId,"cleanupOnly":cleanup,"frontBundle":m.expectedBundle,"frontPid":m.front.processIdentifier,"expectedAxWindowTitle":m.expectedTitle,"axWindowCount":m.windowCount,"axWindow":encodedRectangle(m.frame),"axViewport":encodedRectangle(m.view),"posting":"cghidEventTap/constructor-default-timestamp"]
if let fallback=m.safariScroll {result["axViewportProof"]=fallback.proof}
var events:[(CGEvent,String)] = []
if pointer {
    guard let p=r["point"] as? [String:Any],closed(p,["x","y"]),let x=number(p["x"]),let y=number(p["y"]),x>=0,x<w,y>=0,y<h else {refuse("Fixed CSS point outside actual viewport")}
    let point:CGPoint
    if let fallback=m.safariScroll {guard let value=safariScrollViewportPoint(viewport:fallback.scroll,visible:fallback.visible,cssWidth:w,cssHeight:h,x:x,y:y) else {refuse("Point outside genuine visible Safari content")};point=value}
    else {point=CGPoint(x:m.view.minX+x*m.view.width/w,y:m.view.minY+y*m.view.height/h)}
    let type:CGEventType = ["hover-source","move-start"].contains(action) ? .mouseMoved : action=="down" ? .leftMouseDown : action=="up" ? .leftMouseUp : .leftMouseDragged
    guard let event=CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:point,mouseButton:.left) else {refuse("Fixed pointer allocation failed")}
    event.setIntegerValueField(.mouseEventClickState,value:type == .mouseMoved ? 0 : 1)
    if let previous=r["previousScreenPoint"] as? [String:Any] {
        guard closed(previous,["x","y"]),let px=number(previous["x"]),let py=number(previous["y"]) else {refuse("Original pointer delta malformed")}
        event.setIntegerValueField(.mouseEventDeltaX,value:Int64((point.x-px).rounded()));event.setIntegerValueField(.mouseEventDeltaY,value:Int64((point.y-py).rounded()))
    } else if !(r["previousScreenPoint"] is NSNull) {refuse("Original pointer delta malformed")}
    events=[(event,action=="up" ? "up" : action=="down" ? "down" : type == .leftMouseDragged ? "drag" : "move")]
    result["screenPoint"]=["x":point.x,"y":point.y];result["constructorTimestampNs"]=String(event.timestamp)
} else {
    let (key,modifiers)=keys[action]!,codes:[String:CGKeyCode]=["command":55,"shift":56]
    var steps:[(CGKeyCode,Bool,CGEventFlags,String)]=[],flags:CGEventFlags=[]
    if cleanup {for modifier in modifiers {steps.append((codes[modifier]!,false,[],modifier+"-up"))};steps.append((key,false,[],"key\(key)-up"))}
    else {
        for modifier in modifiers {flags.insert(modifier=="command" ? .maskCommand : .maskShift);steps.append((codes[modifier]!,true,flags,modifier+"-down"))}
        steps.append((key,true,flags,"key\(key)-down"));steps.append((key,false,flags,"key\(key)-up"))
        for modifier in modifiers.reversed() {flags.remove(modifier=="command" ? .maskCommand : .maskShift);steps.append((codes[modifier]!,false,flags,modifier+"-up"))}
    }
    for (key,down,flags,label) in steps {guard let event=CGEvent(keyboardEventSource:nil,virtualKey:key,keyDown:down) else {refuse("Fixed key allocation failed")};event.flags=flags;events.append((event,label))}
    result["programId"]="drag44-fixed-key/1";result["keyCode"]=Int(key);result["modifiers"]=modifiers
}
for (event,label) in events {
    _=recheckWindow(m,d);posted=true;event.post(tap:.cghidEventTap);postedTransitions.append(label)
}
completedCore=true
result["coreComplete"]=true;result["postedTransitions"]=postedTransitions;result["postUptimeNs"]=String(DispatchTime.now().uptimeNanoseconds)
_=recheckWindow(m,d)
guard elapsed()<=d else {refuse("Original physical deadline expired after complete core")}
result["status"]="sent";result["delivery"]="sent";result["elapsedMs"]=elapsed();emit(result,0)
