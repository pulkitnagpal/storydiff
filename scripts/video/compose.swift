// Composes the Storydiff 1.0 launch film (scripts/video/make-film.sh runs it).
// Every card, page and transcript in the film is a capture listed in scripts/video/assets/manifest.json (a real one from a
// v1 run, or a stand-in until then). On the whiteboard, each card is drawn from its own pieces, cut out of the real card
// by stage.ts, so the finished drawing is the real card exactly; this file only decides the order a person would explain
// it in. Writes raw BGRA frames to stdout for ffmpeg.
//
//   compose <dist/film/build>                      frames to stdout
//   FILM_ONLY=1.5,20 FILM_STILLS=dir compose ...   PNG stills
//   FILM_LOGO=docs/img compose ...                 the logo files
//   FILM_VERIFY=1 compose ...                      checks each drawn card against the flat render
import AppKit
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let W: CGFloat = 1920, H: CGFloat = 1080
let env0 = ProcessInfo.processInfo.environment
/// Frames per second, and the supersampling factor: each frame is drawn at 2x and scaled down.
let FPS = Double(env0["FILM_FPS"] ?? "60") ?? 60, SS = CGFloat(Double(env0["FILM_SS"] ?? "2") ?? 2)
let BUILD = URL(fileURLWithPath: CommandLine.arguments[1])
let env = ProcessInfo.processInfo.environment

// MARK: - palette and type (the card's own)

func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: a)
}
let INK = rgb(0x16161A), BODY = rgb(0x3F3F46), MUTED = rgb(0x6B6B74), FAINT = rgb(0x8E8A84), PAPER = rgb(0xF7F6F3)
let LINE = rgb(0xE6E3DD), ORANGE = rgb(0xC2410C), ORANGE2 = rgb(0xF0752E), TEAL = rgb(0x0F766E), TEALBG = rgb(0xE3F1EF)
let INDIGO = rgb(0x4338CA), RED = rgb(0xD1242F), REDBG = rgb(0xFDE2E1), WHITE = rgb(0xFFFFFF), MARKER_RED = rgb(0xD92D20)
let GH_GREEN = rgb(0x1F883D), GH_BORDER = rgb(0xD1D9E0), GH_MUTED = rgb(0x59636E), GH_TEXT = rgb(0x1F2328), GH_BG = rgb(0xF6F8FA)

let interDesc: CTFontDescriptor? = {
    let u = BUILD.appendingPathComponent("inter.ttf")
    guard FileManager.default.fileExists(atPath: u.path) else { FileHandle.standardError.write(Data("no Inter: using the system font\n".utf8)); return nil }
    return (CTFontManagerCreateFontDescriptorsFromURL(u as CFURL) as? [CTFontDescriptor])?.first
}()
var fontCache: [String: CTFont] = [:]
/// Inter at a weight (100–900), with the optical size the font asks for.
func inter(_ size: CGFloat, _ wght: CGFloat = 400) -> CTFont {
    let key = "\(size)-\(wght)"
    if let f = fontCache[key] { return f }
    let f: CTFont
    if let d = interDesc {
        let axes: [NSNumber: NSNumber] = [NSNumber(value: 0x77676874): NSNumber(value: Double(wght)), NSNumber(value: 0x6F70737A): NSNumber(value: Double(min(32, max(14, size))))]
        let d2 = CTFontDescriptorCreateCopyWithAttributes(d, [kCTFontVariationAttribute as String: axes] as CFDictionary)
        f = CTFontCreateWithFontDescriptor(d2, size, nil)
    } else {
        let w: NSFont.Weight = wght >= 700 ? .bold : wght >= 600 ? .semibold : wght >= 500 ? .medium : .regular
        f = NSFont.systemFont(ofSize: size, weight: w) as CTFont
    }
    fontCache[key] = f
    return f
}
func sys(_ size: CGFloat, _ w: NSFont.Weight = .regular) -> CTFont { NSFont.systemFont(ofSize: size, weight: w) as CTFont }
func mono(_ size: CGFloat, _ w: NSFont.Weight = .regular) -> CTFont { NSFont.monospacedSystemFont(ofSize: size, weight: w) as CTFont }

// MARK: - assets

let index: [String: String] = {
    guard let d = try? Data(contentsOf: BUILD.appendingPathComponent("assets.json")),
          let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let a = o["assets"] as? [String: String] else { fatalError("run stage.ts first") }
    return a
}()
func path(_ name: String) -> URL? { index[name].map { URL(fileURLWithPath: $0) } }
func loadURL(_ u: URL) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(u as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}
func asset(_ name: String) -> CGImage {
    guard let u = path(name), let i = loadURL(u) else { fatalError("missing asset \(name)") }
    return i
}
func optionalAsset(_ name: String) -> CGImage? { path(name).flatMap(loadURL) }
func jsonAt(_ u: URL?) -> [String: Any]? {
    guard let u, let d = try? Data(contentsOf: u) else { return nil }
    return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
}
func json(_ name: String) -> [String: Any] { jsonAt(path(name)) ?? [:] }
func textLines(_ name: String) -> [String] {
    guard let u = path(name), let s = try? String(contentsOf: u, encoding: .utf8) else { return [] }
    var l = s.components(separatedBy: "\n"); if l.last == "" { l.removeLast() }
    return l
}
func num(_ v: Any?) -> CGFloat { (v as? NSNumber).map { CGFloat(truncating: $0) } ?? 0 }
func rect(_ v: Any?) -> CGRect? {
    guard let d = v as? [String: Any], d["x"] != nil else { return nil }
    return CGRect(x: num(d["x"]), y: num(d["y"]), width: num(d["w"]), height: num(d["h"]))
}

// MARK: - easing

func clamp(_ x: CGFloat, _ a: CGFloat = 0, _ b: CGFloat = 1) -> CGFloat { min(max(x, a), b) }
func seg(_ t: CGFloat, _ a: CGFloat, _ b: CGFloat) -> CGFloat { b <= a ? (t >= a ? 1 : 0) : clamp((t - a) / (b - a)) }
func easeOut(_ t: CGFloat) -> CGFloat { 1 - pow(1 - t, 3) }
func easeIn(_ t: CGFloat) -> CGFloat { t * t * t }
func smooth(_ t: CGFloat) -> CGFloat { let x = clamp(t); return x * x * (3 - 2 * x) }
func easeInOut(_ t: CGFloat) -> CGFloat { t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2 }
func spring(_ t: CGFloat) -> CGFloat { t >= 1 ? 1 : 1 - exp(-6.5 * t) * cos(11 * t) }
func lerp(_ a: CGFloat, _ b: CGFloat, _ t: CGFloat) -> CGFloat { a + (b - a) * t }
func lerpPt(_ a: CGPoint, _ b: CGPoint, _ t: CGFloat) -> CGPoint { CGPoint(x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t)) }
/// Smooth, repeatable wobble for a hand-drawn line.
func wob(_ seed: CGFloat, _ x: CGFloat) -> CGFloat { 0.55 * sin(x * 2.1 + seed * 7.3) + 0.3 * sin(x * 4.7 + seed * 3.1) + 0.15 * sin(x * 9.3 + seed) }

// MARK: - drawing (top-left coordinates)

var ctx: CGContext!
func R(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect { CGRect(x: x, y: H - y - h, width: w, height: h) }
func R(_ r: CGRect) -> CGRect { R(r.minX, r.minY, r.width, r.height) }
func P(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x, y: H - p.y) }
func fill(_ c: CGColor) { ctx.setFillColor(c); ctx.fill(CGRect(x: -8 * W, y: -8 * H, width: 20 * W, height: 20 * H)) }
func box(_ r: CGRect, _ c: CGColor, radius: CGFloat = 0, alpha: CGFloat = 1) {
    guard alpha > 0.001 else { return }
    ctx.saveGState(); ctx.setAlpha(alpha)
    ctx.addPath(CGPath(roundedRect: R(r), cornerWidth: min(radius, r.width / 2), cornerHeight: min(radius, r.height / 2), transform: nil)); ctx.setFillColor(c); ctx.fillPath()
    ctx.restoreGState()
}
func stroke(_ r: CGRect, _ c: CGColor, width: CGFloat, radius: CGFloat = 0, alpha: CGFloat = 1) {
    guard alpha > 0.001 else { return }
    ctx.saveGState(); ctx.setAlpha(alpha); ctx.setStrokeColor(c); ctx.setLineWidth(width)
    ctx.addPath(CGPath(roundedRect: R(r), cornerWidth: radius, cornerHeight: radius, transform: nil)); ctx.strokePath()
    ctx.restoreGState()
}
func shadowBox(_ r: CGRect, radius: CGFloat, alpha: CGFloat = 1, strength: CGFloat = 1, color: CGColor = WHITE) {
    guard alpha > 0.001 else { return }
    ctx.saveGState(); ctx.setAlpha(alpha)
    ctx.setShadow(offset: CGSize(width: 0, height: -14 * strength), blur: 46 * strength, color: rgb(0x3A2A20, 0.16))
    ctx.addPath(CGPath(roundedRect: R(r), cornerWidth: radius, cornerHeight: radius, transform: nil)); ctx.setFillColor(color); ctx.fillPath()
    ctx.restoreGState()
}
func glow(_ center: CGPoint, _ radius: CGFloat, _ color: CGColor) {
    let g = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [color, color.copy(alpha: 0)!] as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(g, startCenter: P(center), startRadius: 0, endCenter: P(center), endRadius: radius, options: [])
}
/// The whiteboard: the card's own paper, softly lit.
func board() {
    fill(PAPER)
    glow(CGPoint(x: W * 0.82, y: H * 0.1), 1000, rgb(0xFFFFFF, 0.55))
    glow(CGPoint(x: W * 0.1, y: H * 0.95), 800, rgb(0xEDEAE3, 0.5))
}
func image(_ img: CGImage, _ r: CGRect, alpha: CGFloat = 1, radius: CGFloat = 0, shadow: CGFloat = 0) {
    guard alpha > 0.001 else { return }
    ctx.saveGState(); ctx.setAlpha(alpha)
    if shadow > 0 || radius > 0 {
        let path = CGPath(roundedRect: R(r), cornerWidth: radius, cornerHeight: radius, transform: nil)
        if shadow > 0 {
            ctx.saveGState(); ctx.setShadow(offset: CGSize(width: 0, height: -14 * shadow), blur: 46 * shadow, color: rgb(0x3A2A20, 0.2))
            ctx.addPath(path); ctx.setFillColor(WHITE); ctx.fillPath(); ctx.restoreGState()
        }
        ctx.addPath(path); ctx.clip()
    }
    ctx.interpolationQuality = .high
    ctx.draw(img, in: R(r))
    ctx.restoreGState()
}
func fitW(_ img: CGImage, _ w: CGFloat) -> CGFloat { w * CGFloat(img.height) / CGFloat(img.width) }
func width(_ s: String, _ f: CTFont, kern: CGFloat = 0) -> CGFloat {
    CGFloat(CTLineGetTypographicBounds(CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: [.font: f, .kern: kern])), nil, nil, nil))
}
@discardableResult
func text(_ s: String, _ x: CGFloat, _ y: CGFloat, _ f: CTFont, _ color: CGColor = INK, alpha: CGFloat = 1, align: CGFloat = 0, kern: CGFloat = 0) -> CGFloat {
    let attrs: [NSAttributedString.Key: Any] = [.font: f, .foregroundColor: color.copy(alpha: color.alpha * clamp(alpha))!, .kern: kern]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attrs))
    let w = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
    guard alpha > 0.001 else { return w }
    ctx.textPosition = CGPoint(x: x - w * align, y: H - y - CTFontGetAscent(f))
    CTLineDraw(line, ctx)
    return w
}
@discardableResult
func pill(_ s: String, _ x: CGFloat, _ y: CGFloat, size: CGFloat, fg: CGColor, bg: CGColor, alpha: CGFloat = 1, align: CGFloat = 0, font f0: CTFont? = nil) -> CGRect {
    let f = f0 ?? inter(size, 600)
    let w = width(s, f) + size * 1.5, h = size * 2.1
    let r = CGRect(x: x - w * align, y: y, width: w, height: h)
    guard alpha > 0.001 else { return r }
    box(r, bg, radius: h / 2, alpha: alpha)
    text(s, r.minX + size * 0.75, y + (h - CTFontGetAscent(f) - CTFontGetDescent(f)) / 2, f, fg, alpha: alpha)
    return r
}
func ripple(_ p: CGPoint, _ k: CGFloat, _ color: CGColor = ORANGE2, size: CGFloat = 44) {
    guard k > 0, k < 1 else { return }
    let r = lerp(size * 0.2, size, easeOut(k))
    ctx.saveGState(); ctx.setStrokeColor(color.copy(alpha: 0.6 * (1 - k))!); ctx.setLineWidth(3)
    ctx.strokeEllipse(in: R(p.x - r, p.y - r, 2 * r, 2 * r)); ctx.restoreGState()
}
func dim(_ a: CGFloat, _ c: CGColor = rgb(0xFFFFFF)) { guard a > 0.001 else { return }; ctx.saveGState(); ctx.setAlpha(a); fill(c); ctx.restoreGState() }

/// Zooms everything inside around `focus`, which lands on `at`.
func camera(scale: CGFloat, focus: CGPoint, at: CGPoint, _ draw: () -> Void) {
    ctx.saveGState()
    ctx.translateBy(x: at.x, y: H - at.y); ctx.scaleBy(x: scale, y: scale); ctx.translateBy(x: -focus.x, y: -(H - focus.y))
    draw()
    ctx.restoreGState()
}
func toScreen(_ p: CGPoint, scale: CGFloat, focus: CGPoint, at: CGPoint) -> CGPoint { CGPoint(x: at.x + (p.x - focus.x) * scale, y: at.y + (p.y - focus.y) * scale) }
struct Shot { let at: CGFloat; let dur: CGFloat; let scale: CGFloat; let focus: CGPoint }
func cam(_ t: CGFloat, _ shots: [Shot]) -> (CGFloat, CGPoint) {
    var s = shots[0].scale, f = shots[0].focus
    for sh in shots.dropFirst() {
        let k = easeInOut(seg(t, sh.at, sh.at + sh.dur))
        if k <= 0 { break }
        s = exp(lerp(log(s), log(sh.scale), k)); f = lerpPt(f, sh.focus, k)
    }
    return (s, f)
}
func frameOn(_ r: CGRect, _ maxW: CGFloat, _ maxH: CGFloat, cap: CGFloat = 2.4) -> (CGFloat, CGPoint) { (min(cap, maxW / r.width, maxH / r.height), CGPoint(x: r.midX, y: r.midY)) }
func shot(_ at: CGFloat, _ dur: CGFloat, _ f: (CGFloat, CGPoint)) -> Shot { Shot(at: at, dur: dur, scale: f.0, focus: f.1) }
func union(_ rs: [CGRect]) -> CGRect { rs.dropFirst().reduce(rs.first ?? .zero) { $0.union($1) } }

// MARK: - the marker: hand-drawn strokes

/// Points along a rounded rectangle, clockwise from the top-left, with a little hand wobble.
func wobblyRect(_ r: CGRect, radius: CGFloat, seed: CGFloat, amp: CGFloat = 1.1) -> [CGPoint] {
    let rad = max(0.5, min(radius, r.width / 2, r.height / 2))
    let sw = r.width - 2 * rad, sh = r.height - 2 * rad, arc = CGFloat.pi / 2 * rad
    let total = 2 * sw + 2 * sh + 4 * arc
    var pts: [CGPoint] = []
    let n = 120
    for i in 0...n {
        var d = total * CGFloat(i) / CGFloat(n)
        var p = CGPoint.zero, nrm = CGPoint.zero
        func corner(_ c: CGPoint, _ a0: CGFloat, _ dd: CGFloat) { let a = a0 + dd / rad; p = CGPoint(x: c.x + rad * cos(a), y: c.y + rad * sin(a)); nrm = CGPoint(x: cos(a), y: sin(a)) }
        if d < sw { p = CGPoint(x: r.minX + rad + d, y: r.minY); nrm = CGPoint(x: 0, y: -1) }
        else {
            d -= sw
            if d < arc { corner(CGPoint(x: r.maxX - rad, y: r.minY + rad), -.pi / 2, d) }
            else {
                d -= arc
                if d < sh { p = CGPoint(x: r.maxX, y: r.minY + rad + d); nrm = CGPoint(x: 1, y: 0) }
                else {
                    d -= sh
                    if d < arc { corner(CGPoint(x: r.maxX - rad, y: r.maxY - rad), 0, d) }
                    else {
                        d -= arc
                        if d < sw { p = CGPoint(x: r.maxX - rad - d, y: r.maxY); nrm = CGPoint(x: 0, y: 1) }
                        else {
                            d -= sw
                            if d < arc { corner(CGPoint(x: r.minX + rad, y: r.maxY - rad), .pi / 2, d) }
                            else {
                                d -= arc
                                if d < sh { p = CGPoint(x: r.minX, y: r.maxY - rad - d); nrm = CGPoint(x: -1, y: 0) }
                                else { corner(CGPoint(x: r.minX + rad, y: r.minY + rad), .pi, min(d - sh, arc)) }
                            }
                        }
                    }
                }
            }
        }
        let w = amp * wob(seed, CGFloat(i) / CGFloat(n) * 6.3)
        pts.append(CGPoint(x: p.x + nrm.x * w, y: p.y + nrm.y * w))
    }
    return pts
}
/// A hand-drawn ellipse that overshoots its start, like a marker circling something.
func wobblyEllipse(_ c: CGPoint, rx: CGFloat, ry: CGFloat, seed: CGFloat) -> [CGPoint] {
    (0...90).map { i in
        let u = CGFloat(i) / 90, a = -2.2 + u * 2 * .pi * 1.12
        let grow = 1 + 0.08 * u + 0.04 * wob(seed, u * 5)
        return CGPoint(x: c.x + rx * grow * cos(a), y: c.y + ry * grow * sin(a))
    }
}
func wobblyLine(_ a: CGPoint, _ b: CGPoint, seed: CGFloat, amp: CGFloat = 2) -> [CGPoint] {
    (0...40).map { i in
        let u = CGFloat(i) / 40
        return CGPoint(x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) + amp * wob(seed, u * 4) - amp * 0.6 * u)
    }
}
/// Draws a polyline up to fraction k, returning where the pen is.
@discardableResult
func ink(_ pts: [CGPoint], _ k: CGFloat, _ color: CGColor, width w: CGFloat, alpha: CGFloat = 1) -> CGPoint? {
    guard k > 0, alpha > 0.001, pts.count > 1 else { return nil }
    let n = max(1, Int(CGFloat(pts.count - 1) * clamp(k)))
    ctx.saveGState(); ctx.setAlpha(alpha); ctx.setStrokeColor(color); ctx.setLineWidth(w); ctx.setLineCap(.round); ctx.setLineJoin(.round)
    ctx.move(to: P(pts[0])); for p in pts[1...n] { ctx.addLine(to: P(p)) }
    ctx.strokePath(); ctx.restoreGState()
    return pts[n]
}

/// The explainer's marker, drawn at its tip.
func marker(_ tip: CGPoint, alpha: CGFloat = 1, press: CGFloat = 0) {
    guard alpha > 0.001 else { return }
    ctx.saveGState(); ctx.setAlpha(alpha)
    ctx.translateBy(x: tip.x, y: H - tip.y); ctx.rotate(by: -0.62)
    ctx.translateBy(x: 0, y: 4 * press)
    ctx.setShadow(offset: CGSize(width: 6, height: -10), blur: 18, color: rgb(0x16161A, 0.28))
    let tipPath = CGMutablePath(); tipPath.move(to: .zero); tipPath.addLine(to: CGPoint(x: -7, y: 16)); tipPath.addLine(to: CGPoint(x: 7, y: 16)); tipPath.closeSubpath()
    ctx.addPath(tipPath); ctx.setFillColor(ORANGE); ctx.fillPath()
    ctx.addPath(CGPath(roundedRect: CGRect(x: -10, y: 15, width: 20, height: 18), cornerWidth: 3, cornerHeight: 3, transform: nil)); ctx.setFillColor(rgb(0x2A2A30)); ctx.fillPath()
    ctx.addPath(CGPath(roundedRect: CGRect(x: -13, y: 32, width: 26, height: 92), cornerWidth: 9, cornerHeight: 9, transform: nil)); ctx.setFillColor(INK); ctx.fillPath()
    ctx.setShadow(offset: .zero, blur: 0, color: nil)
    ctx.addPath(CGPath(roundedRect: CGRect(x: -13, y: 92, width: 26, height: 12), cornerWidth: 2, cornerHeight: 2, transform: nil)); ctx.setFillColor(ORANGE2); ctx.fillPath()
    ctx.restoreGState()
}
/// A plain arrow cursor.
func cursor(_ p: CGPoint, alpha: CGFloat = 1, press: CGFloat = 0) {
    guard alpha > 0.001 else { return }
    ctx.saveGState(); ctx.setAlpha(alpha); ctx.translateBy(x: p.x, y: H - p.y); let s = 1.5 * (1 - 0.12 * press); ctx.scaleBy(x: s, y: s)
    let a = CGMutablePath()
    a.move(to: .zero); a.addLine(to: CGPoint(x: 0, y: -25)); a.addLine(to: CGPoint(x: 6, y: -19)); a.addLine(to: CGPoint(x: 10.5, y: -28.5))
    a.addLine(to: CGPoint(x: 14.5, y: -26.5)); a.addLine(to: CGPoint(x: 10, y: -17.5)); a.addLine(to: CGPoint(x: 18, y: -17.5)); a.closeSubpath()
    ctx.setShadow(offset: CGSize(width: 0, height: -2), blur: 6, color: rgb(0, 0.35))
    ctx.addPath(a); ctx.setFillColor(INK); ctx.fillPath()
    ctx.setShadow(offset: .zero, blur: 0, color: nil)
    ctx.addPath(a); ctx.setStrokeColor(WHITE); ctx.setLineWidth(1.6); ctx.strokePath()
    ctx.restoreGState()
}

// MARK: - the logo

/// The mark in a size×size box (top-left coordinates): a dark squircle and a line of change, drawn by hand.
func markPaths(_ size: CGFloat, inset: CGFloat = 0) -> (CGPath, CGPath) {
    let u = (size - 2 * inset) / 512
    func T(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: inset + x * u, y: inset + y * u) }
    let sq = CGMutablePath()
    for i in 0...240 {
        let a = CGFloat(i) / 240 * 2 * .pi, n: CGFloat = 4.2
        let cx = pow(abs(cos(a)), 2 / n) * (cos(a) < 0 ? -1 : 1), cy = pow(abs(sin(a)), 2 / n) * (sin(a) < 0 ? -1 : 1)
        let p = T(256 + 256 * cx, 256 + 256 * cy)
        if i == 0 { sq.move(to: p) } else { sq.addLine(to: p) }
    }
    sq.closeSubpath()
    // The stroke: the card header's own curve (M7 19 C11 13, 15 21, 23 11 on a 30 grid), with a marker's pressure:
    // full where it starts, easing as it lifts off.
    let g: CGFloat = 512 / 30
    let p0 = CGPoint(x: 7 * g, y: 19 * g), p1 = CGPoint(x: 11 * g, y: 13 * g), p2 = CGPoint(x: 15 * g, y: 21 * g), p3 = CGPoint(x: 23 * g, y: 11 * g)
    func bez(_ t: CGFloat) -> CGPoint {
        let m = 1 - t
        return CGPoint(x: m * m * m * p0.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t * t * t * p3.x,
                       y: m * m * m * p0.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t * t * t * p3.y)
    }
    func wdt(_ t: CGFloat) -> CGFloat { 58 + 8 * sin(.pi * t) - 20 * t * t }
    var left: [CGPoint] = [], right: [CGPoint] = []
    let N = 200
    for i in 0...N {
        let t = CGFloat(i) / CGFloat(N)
        let a = bez(max(0, t - 0.002)), b = bez(min(1, t + 0.002)), c = bez(t)
        let dx = b.x - a.x, dy = b.y - a.y, l = max(0.0001, hypot(dx, dy))
        let nx = -dy / l, ny = dx / l, w = wdt(t) / 2
        left.append(T(c.x + nx * w, c.y + ny * w)); right.append(T(c.x - nx * w, c.y - ny * w))
    }
    let st = CGMutablePath()
    st.move(to: left[0]); for p in left.dropFirst() { st.addLine(to: p) }
    for p in right.reversed() { st.addLine(to: p) }
    st.closeSubpath()
    // Round ends: the marker's tip where it touched down and where it lifted.
    var stroke: CGPath = st
    for t in [CGFloat(0), 1] {
        let c = bez(t), r = wdt(t) / 2
        stroke = stroke.union(CGPath(ellipseIn: CGRect(x: inset + (c.x - r) * u, y: inset + (c.y - r) * u, width: 2 * r * u, height: 2 * r * u), transform: nil))
    }
    return (sq, stroke)
}
/// Draws the mark with its top-left at (x, y). `draw` reveals the stroke from its start.
func mark(_ x: CGFloat, _ y: CGFloat, size: CGFloat, draw k: CGFloat = 1, alpha: CGFloat = 1, scale: CGFloat = 1) {
    guard alpha > 0.001 else { return }
    let (sq, st) = markPaths(size)
    ctx.saveGState(); ctx.setAlpha(alpha)
    ctx.translateBy(x: x + size / 2, y: H - y - size / 2); ctx.scaleBy(x: scale, y: scale); ctx.translateBy(x: -size / 2, y: size / 2)
    ctx.scaleBy(x: 1, y: -1)   // the paths are in top-left coordinates
    ctx.saveGState(); ctx.setShadow(offset: CGSize(width: 0, height: 10 * size / 150), blur: 30 * size / 150, color: rgb(0x16161A, 0.25))
    ctx.addPath(sq); ctx.setFillColor(INK); ctx.fillPath(); ctx.restoreGState()
    if k > 0 {
        ctx.saveGState()
        if k < 1 { ctx.clip(to: CGRect(x: 0, y: 0, width: size * (0.18 + 0.68 * easeInOut(k)), height: size)) }
        ctx.addPath(st); ctx.setFillColor(ORANGE2); ctx.fillPath()
        ctx.restoreGState()
    }
    ctx.restoreGState()
}
let WORD_KERN: CGFloat = -0.025
/// Mark + "Storydiff" in Inter Bold. Returns the lockup's width.
@discardableResult
func lockup(_ x: CGFloat, _ y: CGFloat, markSize m: CGFloat, alpha: CGFloat = 1, markK: CGFloat = 1, markScale: CGFloat = 1, wordAlpha: CGFloat = 1, wordDX: CGFloat = 0, measureOnly: Bool = false) -> CGFloat {
    let f = inter(m * 0.86, 700)
    let gap = m * 0.27
    let cap = CTFontGetCapHeight(f)
    let ww = width("Storydiff", f, kern: m * 0.86 * WORD_KERN)
    if measureOnly { return m + gap + ww }
    mark(x, y, size: m, draw: markK, alpha: alpha * clamp(markScale * 2 - 0.6), scale: markScale)
    text("Storydiff", x + m + gap + wordDX, y + m / 2 + cap / 2 - CTFontGetAscent(f), f, INK, alpha: alpha * wordAlpha, kern: m * 0.86 * WORD_KERN)
    return m + gap + ww
}

// MARK: - captions: the explainer talking, set in Inter under the picture

struct Caption { let start: CGFloat; let end: CGFloat; let text: String; let underline: String? }
var captions: [Caption] = []
func say(_ start: CGFloat, _ end: CGFloat, _ s: String, _ u: String? = nil) { captions.append(Caption(start: start, end: end, text: s, underline: u)) }
let CAP_KERN: CGFloat = -0.6
func drawCaptions(_ t: CGFloat) {
    if env0["FILM_NOCAPTIONS"] != nil { return }
    for c in captions where t >= c.start && t < c.end {
        let inT = easeOut(seg(t, c.start, c.start + 0.5)), out = 1 - easeOut(seg(t, c.end - 0.35, c.end))
        let a = inT * out
        let f = inter(46, 600)
        let w = width(c.text, f, kern: CAP_KERN) + 76, h: CGFloat = 86
        let y: CGFloat = 898 + (1 - inT) * 22
        let r = CGRect(x: (W - w) / 2, y: y, width: w, height: h)
        ctx.saveGState(); ctx.setAlpha(a * 0.97)
        ctx.setShadow(offset: CGSize(width: 0, height: -8), blur: 30, color: rgb(0x3A2A20, 0.14))
        ctx.addPath(CGPath(roundedRect: R(r), cornerWidth: h / 2, cornerHeight: h / 2, transform: nil)); ctx.setFillColor(WHITE); ctx.fillPath()
        ctx.restoreGState()
        let tx = r.minX + 38, ty = y + (h - CTFontGetAscent(f) - CTFontGetDescent(f)) / 2
        text(c.text, tx, ty, f, INK, alpha: a, kern: CAP_KERN)
        if let u = c.underline, let range = c.text.range(of: u) {
            let pre = String(c.text[..<range.lowerBound])
            let x0 = tx + width(pre, f, kern: CAP_KERN), x1 = x0 + width(u, f, kern: CAP_KERN)
            let k = easeInOut(seg(t, c.start + 0.45, c.start + 0.85))
            let base = ty + CTFontGetAscent(f) + 9
            ink(wobblyLine(CGPoint(x: x0 - 4, y: base), CGPoint(x: x1 + 6, y: base - 2), seed: c.start, amp: 2.2), k, ORANGE2, width: 6, alpha: a * 0.9)
        }
    }
}

// MARK: - scenes

typealias Draw = (CGFloat) -> Void
enum Enter { case none, cross, eraser, flip, pan, circle }
struct Scene { let start: CGFloat; let end: CGFloat; let enter: Enter; let dur: CGFloat; let draw: Draw }

// MARK: 1. The hook: a dramatised agent PR (no real repo)

struct DRow { let kind: Int; let text: String; let y: CGFloat; let h: CGFloat; let new: Int? }
let diffRows: [DRow] = {
    var out: [DRow] = [], y: CGFloat = 0, n = 0
    for raw in textLines("diff.patch") {
        let l = raw.replacingOccurrences(of: "\t", with: "  ")
        if l.hasPrefix("diff --git ") { if !out.isEmpty { y += 14 }; out.append(DRow(kind: 0, text: l.components(separatedBy: " b/").last ?? l, y: y, h: 42, new: nil)); y += 42 }
        else if l.hasPrefix("@@") {
            n = Int(l.split(separator: " ").first(where: { $0.hasPrefix("+") })?.dropFirst().split(separator: ",").first ?? "1") ?? 1
            out.append(DRow(kind: 1, text: l, y: y, h: 28, new: nil)); y += 28
        }
        else if l.hasPrefix("+++") || l.hasPrefix("---") || l.hasPrefix("index ") || l.hasPrefix("new file") || l.hasPrefix("\\") { continue }
        else if l.hasPrefix("+") { out.append(DRow(kind: 2, text: String(l.dropFirst()), y: y, h: 24, new: n)); y += 24; n += 1 }
        else if l.hasPrefix("-") { out.append(DRow(kind: 3, text: String(l.dropFirst()), y: y, h: 24, new: nil)); y += 24 }
        else if !out.isEmpty { out.append(DRow(kind: 4, text: String(l.dropFirst()), y: y, h: 24, new: n)); y += 24; n += 1 }
    }
    return out
}()
let diffH = diffRows.last.map { $0.y + $0.h } ?? 1000
let filesTab = optionalAsset("diff-files-tab.png")
let grouped: NumberFormatter = { let f = NumberFormatter(); f.numberStyle = .decimal; f.locale = Locale(identifier: "en_US"); return f }()
func fmt(_ n: Int) -> String { grouped.string(from: NSNumber(value: n)) ?? "\(n)" }

let HWIN = CGRect(x: 90, y: 34, width: 1740, height: 890)
let HOOK_APPROVE: CGFloat = 5.0, HOOK_FREEZE: CGFloat = 6.6
func hookRows(_ content: CGRect, scroll: CGFloat, blur: CGFloat) {
    let passes = blur > 0.05 ? 6 : 1
    for pass in 0..<passes {
        let base = scroll - CGFloat(pass) * blur * 30
        let a: CGFloat = pass == 0 ? 1 : 0.22
        if let img = filesTab {
            let h = fitW(img, content.width)
            let s = base.truncatingRemainder(dividingBy: max(h - content.height, 1))
            image(img, CGRect(x: content.minX, y: content.minY - s, width: content.width, height: h), alpha: a)
            continue
        }
        // The rows, repeated: this PR never ends.
        let rep = floor(base / diffH)
        for k in [rep, rep + 1] {
            for r in diffRows {
                let y = content.minY + r.y + k * diffH - base
                guard y + r.h > content.minY, y < content.maxY else { continue }
                ctx.saveGState(); ctx.setAlpha(a)
                switch r.kind {
                case 0:
                    box(CGRect(x: content.minX + 20, y: y + 4, width: content.width - 40, height: r.h - 6), GH_BG, radius: 6)
                    stroke(CGRect(x: content.minX + 20, y: y + 4, width: content.width - 40, height: r.h - 6), GH_BORDER, width: 1, radius: 6)
                    text("▾  " + r.text, content.minX + 40, y + 15, mono(15, .semibold), GH_TEXT)
                case 1: box(CGRect(x: content.minX + 20, y: y, width: content.width - 40, height: r.h), rgb(0xDDF4FF, 0.7)); text(r.text, content.minX + 130, y + 6, mono(13.5), GH_MUTED)
                default:
                    if r.kind == 2 { box(CGRect(x: content.minX + 20, y: y, width: content.width - 40, height: r.h), rgb(0xE6FFEC)) }
                    if r.kind == 3 { box(CGRect(x: content.minX + 20, y: y, width: content.width - 40, height: r.h), rgb(0xFFEBE9)) }
                    if let n = r.new { text("\(n)", content.minX + 100, y + 5, mono(13), FAINT, align: 1) }
                    text(r.kind == 2 ? "+" : r.kind == 3 ? "−" : " ", content.minX + 118, y + 2, mono(15), r.kind == 2 ? rgb(0x1A7F37) : rgb(0xCF222E))
                    text(String(r.text.prefix(150)), content.minX + 140, y + 2, mono(15), GH_TEXT)
                }
                ctx.restoreGState()
            }
        }
    }
}
let hook = Scene(start: 0, end: 9.0, enter: .none, dur: 0, draw: { t in
    fill(rgb(0xEEECE7))
    let w = HWIN
    shadowBox(w, radius: 16)
    ctx.saveGState(); ctx.addPath(CGPath(roundedRect: R(w), cornerWidth: 16, cornerHeight: 16, transform: nil)); ctx.clip()
    box(w, WHITE)
    box(CGRect(x: w.minX, y: w.minY, width: w.width, height: 48), rgb(0xF1EFEB))
    for i in 0..<3 { box(CGRect(x: w.minX + 22 + CGFloat(i) * 22, y: w.minY + 18, width: 13, height: 13), rgb(0xD6D3CD), radius: 6.5) }
    box(CGRect(x: w.midX - 280, y: w.minY + 10, width: 560, height: 28), WHITE, radius: 14)
    text("Pull request · Files changed", w.midX, w.minY + 15, sys(15, .medium), GH_MUTED, align: 0.5)
    // The PR header, its numbers racing up.
    let race = 0.3 + 0.7 * easeOut(seg(t, 0, 1.9))
    let x0 = w.minX + 48
    text("Agent-written PR", x0, w.minY + 78, sys(40, .regular), GH_TEXT)
    pill("● Open", x0, w.minY + 140, size: 16, fg: WHITE, bg: GH_GREEN, font: sys(16, .semibold))
    text("an agent wants to merge 214 commits into main", x0 + 104, w.minY + 146, sys(18), GH_MUTED)
    let dw = text("−\(fmt(Int(9870 * race)))", w.maxX - 60, w.minY + 88, mono(32, .bold), rgb(0xCF222E), align: 1)
    text("+\(fmt(Int(48213 * race)))", w.maxX - 84 - dw, w.minY + 88, mono(32, .bold), rgb(0x1A7F37), align: 1)
    // Approved, one minute in.
    let ap = easeOut(seg(t, HOOK_APPROVE + 0.2, HOOK_APPROVE + 0.6))
    var minuteRect = CGRect.zero
    if ap > 0 {
        let f = sys(19, .semibold)
        let s1 = "✓ Approved · ", s2 = "1 minute", s3 = " after opening"
        let tw = width(s1 + s2 + s3, f) + 32
        let r = CGRect(x: w.maxX - 60 - tw, y: w.minY + 138 + (1 - ap) * 10, width: tw, height: 38)
        box(r, rgb(0xDAFBE1), radius: 19, alpha: ap)
        var cx = r.minX + 16
        cx += text(s1, cx, r.minY + 9, f, rgb(0x116329), alpha: ap)
        let mw = text(s2, cx, r.minY + 9, f, rgb(0x116329), alpha: ap)
        minuteRect = CGRect(x: cx, y: r.minY + 6, width: mw, height: 26)
        text(s3, cx + mw, r.minY + 9, f, rgb(0x116329), alpha: ap)
    }
    // Tabs.
    let ty = w.minY + 196
    box(CGRect(x: w.minX, y: ty + 46, width: w.width, height: 1), GH_BORDER)
    var tx = x0
    for (name, n) in [("Conversation", "1"), ("Commits", "214"), ("Checks", "3"), ("Files changed", fmt(Int(2000 * race)))] {
        let on = name == "Files changed"
        let nw = text(name, tx, ty + 10, sys(18, on ? .semibold : .regular), on ? GH_TEXT : GH_MUTED)
        let cr = pill(n, tx + nw + 8, ty + 8, size: 13, fg: GH_TEXT, bg: rgb(0xE8EBEF), font: sys(13, .semibold))
        if on { box(CGRect(x: tx - 8, y: ty + 44, width: cr.maxX - tx + 16, height: 3), rgb(0xFD8C73)) }
        tx = cr.maxX + 34
    }
    // Toolbar: the file counter and Approve.
    let tb = ty + 62
    text("\(fmt(Int(2000 * race))) files changed", x0, tb + 10, sys(21, .semibold), GH_TEXT)
    let pressed = seg(t, HOOK_APPROVE, HOOK_APPROVE + 0.12) * (1 - seg(t, HOOK_APPROVE + 0.12, HOOK_APPROVE + 0.3))
    let approved = t >= HOOK_APPROVE + 0.15
    let btn = CGRect(x: w.maxX - 230, y: tb, width: 180, height: 46)
    box(btn.insetBy(dx: pressed * 3, dy: pressed * 2), approved ? rgb(0x116329) : GH_GREEN, radius: 8)
    text(approved ? "✓ Approved" : "Approve", btn.midX, btn.minY + 12, sys(19, .semibold), WHITE, align: 0.5)
    // The files, scrolling faster than anyone reads.
    let content = CGRect(x: w.minX, y: tb + 62, width: w.width, height: w.maxY - tb - 62)
    box(CGRect(x: w.minX, y: content.minY - 1, width: w.width, height: 1), GH_BORDER)
    ctx.saveGState(); ctx.clip(to: R(content))
    let sp = seg(min(t, 4.6), 1.9, 4.6)
    let scroll = 260 * seg(t, 0.6, 1.9) + 13000 * pow(sp, 2.2)
    let blur = easeIn(seg(t, 2.0, 3.2)) * (1 - easeOut(seg(t, 4.0, 4.6)))
    hookRows(content, scroll: scroll, blur: blur)
    ctx.restoreGState()
    ctx.restoreGState()
    // The cursor goes straight for Approve.
    let c0 = CGPoint(x: 1180, y: 720), c1 = CGPoint(x: btn.midX + 8, y: btn.midY + 14)
    let mv = easeInOut(seg(t, HOOK_APPROVE - 0.5, HOOK_APPROVE - 0.1))
    cursor(lerpPt(c0, c1, mv), alpha: easeOut(seg(t, 4.3, 4.5)) * (1 - easeOut(seg(t, HOOK_FREEZE + 0.2, HOOK_FREEZE + 0.6))), press: pressed)
    ripple(CGPoint(x: btn.midX, y: btn.midY), seg(t, HOOK_APPROVE, HOOK_APPROVE + 0.6), GH_GREEN, size: 60)
    // Freeze: one minute.
    let fz = easeOut(seg(t, HOOK_FREEZE, HOOK_FREEZE + 0.4))
    if fz > 0 {
        dim(0.22 * fz, PAPER)
        let c = CGPoint(x: minuteRect.midX, y: minuteRect.midY)
        ink(wobblyEllipse(c, rx: minuteRect.width / 2 + 26, ry: minuteRect.height / 2 + 16, seed: 3), easeInOut(seg(t, HOOK_FREEZE + 0.2, HOOK_FREEZE + 0.8)), MARKER_RED, width: 6)
    }
})

// MARK: 2. The turn: an eraser, a blank board, and the name explains itself

let handIndex: [String: (CGImage, CGFloat, CGFloat)] = {
    guard let j = jsonAt(BUILD.appendingPathComponent("hand.json")) else { return [:] }
    var o: [String: (CGImage, CGFloat, CGFloat)] = [:]
    for (k, v) in j { if let d = v as? [String: Any], let f = d["file"] as? String, let i = loadURL(URL(fileURLWithPath: f)) { o[k] = (i, num(d["w"]), num(d["h"])) } }
    return o
}()
/// A handwritten word revealed left to right, as if written now. Returns the pen's position while writing.
@discardableResult
func write(_ name: String, at p: CGPoint, scale s: CGFloat, k: CGFloat, alpha: CGFloat = 1) -> CGPoint? {
    guard let (img, w, h) = handIndex[name], k > 0 else { return nil }
    let k = smooth(k)
    let r = CGRect(x: p.x, y: p.y, width: w * s, height: h * s)
    ctx.saveGState(); ctx.clip(to: R(r.minX, r.minY - 20, r.width * clamp(k), r.height + 40))
    image(img, r, alpha: alpha)
    ctx.restoreGState()
    return k < 1 ? CGPoint(x: r.minX + r.width * k, y: r.minY + r.height * (0.62 + 0.1 * sin(k * 40))) : nil
}
let TURN0: CGFloat = 9.0
let turn = Scene(start: TURN0, end: TURN0 + 4.6, enter: .eraser, dur: 0.85, draw: { t in
    board()
    let r0 = t - TURN0
    let dW = handIndex["diff"]?.1 ?? 300, sW = handIndex["story"]?.1 ?? 340, hH = handIndex["diff"]?.2 ?? 280
    let s: CGFloat = 0.62
    // "diff", then "story" in front of it, then the two join into the name.
    let join = easeInOut(seg(r0, 2.45, 2.95))
    let gap = lerp(70, -10, join)
    let tw = (sW + dW) * s + gap
    let sx = (W - tw) / 2, y = 400 - hH * s / 2
    let lockW = lockup(0, 0, markSize: 150, measureOnly: true)
    let badgeW = width("1.0", inter(26, 700)) + 39
    let lx = (W - lockW - 22 - badgeW) / 2, ly: CGFloat = 325
    let fadeHand = 1 - easeOut(seg(r0, 2.85, 3.2))
    var pen: CGPoint? = nil
    if let p = write("diff", at: CGPoint(x: sx + sW * s + gap, y: y), scale: s, k: seg(r0, 0.95, 1.55), alpha: fadeHand) { pen = p }
    if let p = write("story", at: CGPoint(x: sx, y: y), scale: s, k: seg(r0, 1.65, 2.3), alpha: fadeHand) { pen = p }
    let wk = easeOut(seg(r0, 2.85, 3.3)), mk = spring(seg(r0, 3.0, 3.9))
    if wk > 0 || mk > 0 {
        lockup(lx, ly, markSize: 150, markK: easeInOut(seg(r0, 3.2, 3.8)), markScale: 0.4 + 0.6 * mk, wordAlpha: wk, wordDX: (1 - wk) * -16)
        let b = spring(seg(r0, 3.55, 4.2))
        pill("1.0", lx + lockW + 22, ly + 47 + (1 - b) * 14, size: 26, fg: WHITE, bg: ORANGE, alpha: clamp(b * 2), font: inter(26, 700))
    }
    if let pen { marker(pen) }
    else if r0 > 0.7 && r0 < 2.6 {
        let rest = r0 < 1.6 ? CGPoint(x: sx + sW * s + gap + 10, y: y + hH * s * 0.7) : CGPoint(x: sx + sW * s + 20, y: y + hH * s * 0.75)
        marker(rest, alpha: easeOut(seg(r0, 0.7, 0.95)) * (1 - easeOut(seg(r0, 2.35, 2.6))))
    }
})

// MARK: 3. The author: one Claude Code frame, /storydiff, done

let session = json("session.json")
let author = (session["author"] as? String) ?? "Maya"
let sessionImg = asset("claude-session.png")
let TWIN: CGRect = { let h = min(860, fitW(sessionImg, 1460) + 42); return CGRect(x: 230, y: max(30, (930 - h) / 2), width: 1460, height: h) }()
func termWindow(_ title: String, _ content: () -> Void) {
    shadowBox(TWIN, radius: 16)
    ctx.saveGState()
    ctx.addPath(CGPath(roundedRect: R(TWIN), cornerWidth: 16, cornerHeight: 16, transform: nil)); ctx.clip()
    box(TWIN, WHITE)
    box(CGRect(x: TWIN.minX, y: TWIN.minY, width: TWIN.width, height: 42), rgb(0xF4F2EE))
    for i in 0..<3 { box(CGRect(x: TWIN.minX + 20 + CGFloat(i) * 22, y: TWIN.minY + 15, width: 13, height: 13), rgb(0xD6D3CD), radius: 6.5) }
    text(title, TWIN.midX, TWIN.minY + 12, inter(16, 500), MUTED, align: 0.5)
    ctx.clip(to: R(TWIN.minX, TWIN.minY + 42, TWIN.width, TWIN.height - 42))
    content()
    ctx.restoreGState()
}
let A0: CGFloat = TURN0 + 4.6, TYPE0: CGFloat = A0 + 0.6
let authorScene = Scene(start: A0, end: A0 + 3.0, enter: .flip, dur: 0.6, draw: { t in
    board()
    let inner = CGRect(x: TWIN.minX, y: TWIN.minY + 42, width: TWIN.width, height: TWIN.height - 42)
    let (s, f) = cam(t, [Shot(at: A0, dur: 0, scale: 1, focus: CGPoint(x: W / 2, y: 470)), Shot(at: A0 + 0.2, dur: 2.8, scale: 1.08, focus: CGPoint(x: W / 2, y: 500))])
    camera(scale: s, focus: f, at: CGPoint(x: W / 2, y: 470)) {
        termWindow("\((session["project"] as? String) ?? "linkbox") — Claude Code") {
            image(sessionImg, CGRect(x: inner.minX, y: inner.minY, width: inner.width, height: fitW(sessionImg, inner.width)))
        }
    }
    // Key-cast: what Maya types.
    let ty = easeOut(seg(t, TYPE0 - 0.1, TYPE0 + 0.15))
    let typed = String("/storydiff".prefix(Int(clamp((t - TYPE0) / 0.07, 0, 10))))
    let f0 = mono(44, .semibold)
    let r = CGRect(x: W / 2 - 270, y: TWIN.maxY - 128, width: 540, height: 90)
    let press = seg(t, TYPE0 + 1.0, TYPE0 + 1.1) * (1 - seg(t, TYPE0 + 1.1, TYPE0 + 1.3))
    ctx.saveGState(); ctx.setAlpha(ty)
    ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 40, color: rgb(0x16161A, 0.3))
    ctx.addPath(CGPath(roundedRect: R(r.insetBy(dx: press * 6, dy: press * 3)), cornerWidth: 22, cornerHeight: 22, transform: nil)); ctx.setFillColor(INK); ctx.fillPath()
    ctx.restoreGState()
    let w0 = text("> ", r.minX + 36, r.minY + 20, f0, FAINT, alpha: ty)
    let w1 = text(typed, r.minX + 36 + w0, r.minY + 20, f0, WHITE, alpha: ty)
    if Int(t * 3) % 2 == 0 && typed.count < 10 { box(CGRect(x: r.minX + 40 + w0 + w1, y: r.minY + 21, width: 20, height: 48), rgb(0xFFFFFF, 0.7 * ty)) }
    if typed.count == 10 { text("⏎", r.maxX - 36, r.minY + 20, f0, ORANGE2, alpha: ty * seg(t, TYPE0 + 0.85, TYPE0 + 0.95), align: 1) }
    ripple(CGPoint(x: r.maxX - 60, y: r.midY), seg(t, TYPE0 + 1.0, TYPE0 + 1.6), ORANGE2, size: 70)
})

// MARK: 4. The PR: the card is the first comment

let prImg = asset("pr-comment.png"), prJ = json("pr-comment.json")
let prCss = num(prJ["width"]) > 0 ? num(prJ["width"]) : CGFloat(prImg.width) / 2
let PR0: CGFloat = A0 + 3.0
let prScene = Scene(start: PR0, end: PR0 + 2.7, enter: .cross, dur: 0.35, draw: { t in
    board()
    let pw: CGFloat = 1500, k = pw / prCss
    let page = CGRect(x: (W - pw) / 2, y: 92, width: pw, height: fitW(prImg, pw))
    let cardR = rect(prJ["card"]).map { CGRect(x: page.minX + $0.minX * k, y: page.minY + $0.minY * k, width: $0.width * k, height: $0.height * k) }
        ?? CGRect(x: page.minX, y: page.minY + 300, width: pw, height: 700)
    let (s, f) = cam(t, [Shot(at: PR0, dur: 0, scale: 1, focus: CGPoint(x: W / 2, y: 470)),
                         shot(PR0 + 0.7, 1.8, (1.3, CGPoint(x: cardR.midX, y: cardR.minY + 300)))])
    camera(scale: s, focus: f, at: CGPoint(x: W / 2, y: 470)) {
        let chrome = CGRect(x: page.minX, y: page.minY - 48, width: pw, height: page.height + 48)
        shadowBox(chrome, radius: 14)
        ctx.saveGState(); ctx.addPath(CGPath(roundedRect: R(chrome), cornerWidth: 14, cornerHeight: 14, transform: nil)); ctx.clip()
        box(CGRect(x: chrome.minX, y: chrome.minY, width: pw, height: 48), rgb(0xF1EFEB))
        for i in 0..<3 { box(CGRect(x: chrome.minX + 22 + CGFloat(i) * 22, y: chrome.minY + 18, width: 13, height: 13), rgb(0xD6D3CD), radius: 6.5) }
        box(CGRect(x: chrome.midX - 240, y: chrome.minY + 10, width: 480, height: 28), WHITE, radius: 14)
        text("linkbox · Pull request #12", chrome.midX, chrome.minY + 15, inter(15, 500), MUTED, align: 0.5)
        image(prImg, page)
        ctx.restoreGState()
        ink(wobblyRect(cardR.insetBy(dx: -10, dy: -10), radius: 18, seed: 9, amp: 2), easeInOut(seg(t, PR0 + 0.9, PR0 + 1.7)), ORANGE2, width: 5, alpha: 0.9)
    }
})

// MARK: 5. The whiteboard: the card, drawn and explained

struct Unit { let i: Int; let kind: String; let sel: String; let cls: String; let slot: String; let r: CGRect; let clip: CGRect
              let border: CGFloat; let borderColor: CGColor; let radius: CGFloat; let lines: [CGRect]; let img: CGImage }
struct Pin { let n: Int; let tone: String; let r: CGRect }
struct Board { let key: String; let w: CGFloat; let h: CGFloat; let units: [Unit]; let pins: [Pin]; let parts: [String: CGRect]; let items: [CGRect]; let rest: CGImage? }
func parseColor(_ s: String) -> CGColor {
    let n = s.replacingOccurrences(of: "rgba(", with: "").replacingOccurrences(of: "rgb(", with: "").replacingOccurrences(of: ")", with: "")
        .split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    guard n.count >= 3 else { return INK }
    return CGColor(srgbRed: n[0] / 255, green: n[1] / 255, blue: n[2] / 255, alpha: n.count > 3 ? n[3] : 1)
}
func loadBoard(_ key: String) -> Board {
    guard let j = jsonAt(BUILD.appendingPathComponent("card-\(key).layers.json")) else { fatalError("no layers for \(key)") }
    let dir = BUILD.appendingPathComponent("layers/\(key)")
    let units: [Unit] = ((j["units"] as? [[String: Any]]) ?? []).compactMap { u in
        let i = Int(num(u["i"]))
        guard let img = loadURL(dir.appendingPathComponent("\(i).png")), let r = rect(u), let c = rect(u["clip"]) else { return nil }
        return Unit(i: i, kind: (u["kind"] as? String) ?? "text", sel: (u["sel"] as? String) ?? "", cls: (u["cls"] as? String) ?? "", slot: (u["slot"] as? String) ?? "body",
                    r: r, clip: c, border: num(u["border"]), borderColor: parseColor((u["borderColor"] as? String) ?? ""), radius: num(u["radius"]),
                    lines: ((u["lines"] as? [Any]) ?? []).compactMap(rect), img: img)
    }
    let pins: [Pin] = ((j["pins"] as? [[String: Any]]) ?? []).compactMap { p in rect(p).map { Pin(n: Int(num(p["n"])), tone: (p["tone"] as? String) ?? "g", r: $0) } }
    let parts = ((j["parts"] as? [String: Any]) ?? [:]).compactMapValues { rect($0) }
    return Board(key: key, w: num(j["width"]), h: num(j["height"]), units: units, pins: pins, parts: parts,
                 items: ((j["items"] as? [Any]) ?? []).compactMap(rect), rest: loadURL(dir.appendingPathComponent("rest.png")))
}

/// When each piece of a card is drawn, and what the explainer's hand does along the way.
struct Sticky { let unit: Int; let slap: CGFloat; let fly: CGFloat; let at: CGPoint; let tilt: CGFloat }
struct Plan {
    var at: [Int: (CGFloat, CGFloat)] = [:]          // unit -> (start, duration)
    var slide: [Int: CGFloat] = [:]                   // unit -> x offset it slides in from
    var pinAt: [Int: CGFloat] = [:]                   // pin index -> pop time
    var circles: [(CGRect, CGFloat, CGFloat, CGColor)] = []   // rect, start, end, colour
    var taps: [(CGPoint, CGFloat)] = []
    var stickies: [Sticky] = []
    var restAt: CGFloat = 0
    var penFrom: CGFloat = 0, penTo: CGFloat = 0
}
func unitOrder(_ b: Board) -> [Unit] {
    let rank = ["header": 0, "chapters": 1, "asked": 2, "verdict": 3, "body": 4, "list": 5, "footer": 6]
    return b.units.sorted { (rank[$0.slot] ?? 4, $0.i) < (rank[$1.slot] ?? 4, $1.i) }
}
/// Pins pop once what they sit on has been drawn.
func pinsAfterUnits(_ b: Board, _ p: inout Plan) {
    for (pi, pin) in b.pins.enumerated() where p.pinAt[pi] == nil {
        let c = CGPoint(x: pin.r.midX, y: pin.r.midY)
        func area(_ u: Unit) -> CGFloat { u.r.width * u.r.height }
        let hosts = b.units.filter { $0.r.insetBy(dx: -16, dy: -16).contains(c) }
        let host = hosts.filter { $0.kind != "frame" }.min { area($0) < area($1) } ?? hosts.min { area($0) < area($1) }
        let end = host.flatMap { p.at[$0.i] }.map { $0.0 + $0.1 } ?? p.penTo
        p.pinAt[pi] = end + 0.05
    }
}
func quickPlan(_ b: Board, from: CGFloat, dur: CGFloat) -> Plan {
    var p = Plan()
    let order = unitOrder(b)
    let n = CGFloat(max(order.count - 1, 1))
    let d = max(0.16, min(0.42, 3.2 * dur / n))
    for (k, u) in order.enumerated() { p.at[u.i] = (from + (dur - d) * CGFloat(k) / n, d) }
    p.restAt = from; p.penFrom = from; p.penTo = from + dur
    pinsAfterUnits(b, &p)
    return p
}

let tagsBoard = loadBoard("tags")
let wallBoards: [(Board, String)] = [(loadBoard("infra"), "Infra"), (loadBoard("refactor"), "Refactor"), (loadBoard("big"), "Big PR · chapters")]
let B0: CGFloat = PR0 + 2.7
/// The tags card, explained: asked, did, before, after with its pins, underneath, the list with Maya's words, what to try.
func tagsPlan(_ b: Board, _ T: CGFloat) -> Plan {
    var p = Plan()
    let U = b.units
    func put(_ us: [Unit], _ s: CGFloat, _ d: CGFloat, step: CGFloat) { for (k, u) in us.enumerated() { p.at[u.i] = (T + s + step * CGFloat(k), d) } }
    put(U.filter { $0.slot == "header" }, 0.2, 0.7, step: 0.1)
    let asked = U.filter { $0.slot == "asked" }
    if asked.count >= 4 { p.at[asked[0].i] = (T + 0.9, 0.3); p.at[asked[1].i] = (T + 1.2, 1.5); p.at[asked[2].i] = (T + 3.6, 0.3); p.at[asked[3].i] = (T + 3.9, 1.2) }
    else { put(asked, 0.9, 0.8, step: 0.9) }
    put(U.filter { $0.slot == "verdict" }, 4.6, 0.4, step: 0.25)
    let before = b.parts["before"] ?? .zero, after = b.parts["after"] ?? .zero
    let body = U.filter { $0.slot == "body" }
    let screensBottom = after.maxY + 12
    let mapTop = (body.filter { $0.cls.hasPrefix("strip") }.map(\.r.minY).min() ?? 99999) - 44
    let intro = body.filter { $0.r.maxY < before.minY - 20 }
    let inScreens = body.filter { $0.r.minY >= before.minY - 40 && $0.r.maxY <= screensBottom }
    let arrow = inScreens.filter { $0.r.midX > before.maxX - 4 && $0.r.midX < after.minX + 4 }
    let beforeSet = inScreens.filter { $0.r.midX <= before.maxX - 4 }
    let afterSet = inScreens.filter { $0.r.midX >= after.minX + 4 }
    let calls = body.filter { $0.r.minY > screensBottom - 4 && $0.r.minY < mapTop }
    let map = body.filter { $0.r.minY >= mapTop }
    put(intro, 6.8, 0.45, step: 0.35)
    put(beforeSet, 7.6, 0.55, step: 0.25)
    put(arrow, 9.3, 0.35, step: 0)
    put(afterSet, 9.55, 0.75, step: 0)
    for u in afterSet { p.slide[u.i] = 420 }
    // Each pin on the screens pops on, and the marker circles it.
    let both = before.union(after).insetBy(dx: -30, dy: -30)
    let screenPins = b.pins.enumerated().filter { both.contains(CGPoint(x: $0.element.r.midX, y: $0.element.r.midY)) }
    for (k, e) in screenPins.enumerated() {
        let s = T + 10.7 + CGFloat(k) * 0.6
        p.pinAt[e.offset] = s
        p.circles.append((e.element.r.insetBy(dx: -12, dy: -12), s + 0.15, T + 12.7, ORANGE2))
    }
    put(calls, 12.8, 0.32, step: 0.16)
    put(map, 12.8 + CGFloat(calls.count) * 0.16 + 0.1, 0.3, step: 0.1)
    // The list: tap each number; the human's words go up on sticky notes, then settle into the card.
    let list = U.filter { $0.slot == "list" }
    let watchY = b.items.count >= 2 ? b.items[b.items.count - 2].minY : 99999
    let watchStart = list.firstIndex { $0.sel == ".lbl" && $0.r.maxY <= watchY + 2 && $0.r.minY > watchY - 60 } ?? list.count
    var tl = T + 15.4
    for (k, u) in list.enumerated() where k < watchStart && u.kind != "sticky" {
        let isItem = u.sel == ".li"
        p.at[u.i] = (tl, isItem ? 0.55 : 0.3)
        if isItem { p.taps.append((CGPoint(x: u.r.minX + 25, y: u.r.minY + 22), tl)) }
        tl += isItem ? 0.62 : 0.32
    }
    let listR = b.parts["list"] ?? .zero
    for (k, u) in list.filter({ $0.kind == "sticky" }).enumerated() {
        let slap = T + 16.6 + CGFloat(k) * 0.95, fly = T + 19.0
        p.stickies.append(Sticky(unit: u.i, slap: slap, fly: fly, at: CGPoint(x: listR.minX - (k == 0 ? 430 : 260), y: u.r.midY - (k == 0 ? 130 : 30)), tilt: k == 0 ? -0.07 : 0.055))
        p.at[u.i] = (fly + 0.45, 0.2)
    }
    // Two things to try: circle the chip, then each item.
    var tw = T + 19.9
    if let tryR = b.parts["try"] { p.circles.append((tryR.insetBy(dx: -10, dy: -10), tw + 0.2, tw + 1.6, ORANGE2)) }
    tw += 0.9
    for u in list[watchStart...] where u.kind != "sticky" {
        let isItem = u.sel == ".li"
        p.at[u.i] = (tw, isItem ? 0.7 : 0.3)
        if isItem { p.taps.append((CGPoint(x: u.r.minX + 25, y: u.r.minY + 22), tw)) }
        tw += isItem ? 0.8 : 0.35
    }
    put(U.filter { $0.slot == "footer" }, tw - T + 0.1, 0.5, step: 0)
    // Anything not placed yet is drawn with the part underneath.
    for u in U where p.at[u.i] == nil { p.at[u.i] = (T + 14.6, 0.3) }
    p.restAt = T + 0.2; p.penFrom = T; p.penTo = tw + 0.6
    pinsAfterUnits(b, &p)
    return p
}
let tagsP = tagsPlan(tagsBoard, B0)
let stickyImgs: [Int: (CGImage, CGFloat, CGFloat)] = Dictionary(uniqueKeysWithValues: tagsBoard.units.filter { $0.kind == "sticky" }.compactMap { u in handIndex["sticky-\(u.i)"].map { (u.i, $0) } })

func drawPin(_ p: Pin, origin o: CGPoint, k: CGFloat) {
    guard k > 0.001 else { return }
    let c = CGPoint(x: o.x + p.r.midX, y: o.y + p.r.midY), d = p.r.width * (0.3 + 0.7 * k)
    let col: CGColor = ["g": TEAL, "o": ORANGE, "c": INDIGO, "x": FAINT, "k": WHITE][p.tone] ?? TEAL
    let a = clamp(k * 2)
    ctx.saveGState(); ctx.setAlpha(a)
    ctx.setFillColor(WHITE); ctx.fillEllipse(in: R(c.x - d / 2 - 3, c.y - d / 2 - 3, d + 6, d + 6))
    ctx.setFillColor(col); ctx.fillEllipse(in: R(c.x - d / 2, c.y - d / 2, d, d))
    if p.tone == "k" { ctx.setStrokeColor(FAINT); ctx.setLineWidth(1.5); ctx.setLineDash(phase: 0, lengths: [3, 2.5]); ctx.strokeEllipse(in: R(c.x - d / 2 + 0.75, c.y - d / 2 + 0.75, d - 1.5, d - 1.5)) }
    ctx.restoreGState()
    let f = inter(13 * (p.r.width / 26) * (0.3 + 0.7 * k), 700)
    text("\(p.n)", c.x, c.y - (CTFontGetAscent(f) + CTFontGetDescent(f)) / 2, f, p.tone == "k" ? MUTED : WHITE, alpha: a, align: 0.5)
}

/// Draws a card on the board as of time t; returns where the marker is (board coordinates) and how hard it presses.
@discardableResult
func drawCard(_ b: Board, origin o: CGPoint, t: CGFloat, plan p: Plan, stickyImages: [Int: (CGImage, CGFloat, CGFloat)] = [:]) -> (CGPoint, CGFloat)? {
    func at(_ r: CGRect) -> CGRect { r.offsetBy(dx: o.x, dy: o.y) }
    if let rest = b.rest { image(rest, CGRect(x: o.x, y: o.y, width: b.w, height: b.h), alpha: easeOut(seg(t, p.restAt, p.restAt + 0.4))) }
    var pen: (CGPoint, CGFloat, CGFloat)? = nil   // point, start time, press
    func offer(_ pt: CGPoint, _ s: CGFloat, _ press: CGFloat = 0) { if pen == nil || s >= pen!.1 { pen = (pt, s, press) } }
    for u in b.units {
        guard let (s, d) = p.at[u.i], t >= s else { continue }
        let k = smooth(seg(t, s, s + d))
        let clip = at(u.clip), r = at(u.r)
        if k >= 1 { image(u.img, clip); continue }
        if let dx = p.slide[u.i] {
            let e = easeOut(k)
            image(u.img, clip.offsetBy(dx: (1 - e) * dx, dy: 0), alpha: clamp(k * 2.5))
            offer(CGPoint(x: r.midX + (1 - e) * dx, y: r.maxY), s)
            continue
        }
        switch u.kind {
        case _ where u.kind == "frame" || (u.kind == "box" && u.border >= 0.9):
            // The marker draws the outline, then the real piece shows through.
            let pts = wobblyRect(r, radius: max(u.radius, 4), seed: CGFloat(u.i), amp: 1.2)
            if let h = ink(pts, clamp(k / 0.62), u.border >= 0.9 ? u.borderColor : INK, width: max(1.6, u.border), alpha: 1 - seg(k, 0.75, 1)), k < 0.62 { offer(h, s) }
            image(u.img, clip, alpha: seg(k, 0.5, 1))
        case "image":
            ctx.saveGState(); ctx.clip(to: R(clip.minX, clip.minY, clip.width, max(1, clip.height * easeOut(k))))
            image(u.img, clip, alpha: clamp(k * 2)); ctx.restoreGState()
            offer(CGPoint(x: r.midX, y: r.minY + r.height * easeOut(k)), s)
        case "text", "sticky":
            // Written line by line, left to right.
            let ls = u.lines.isEmpty ? [r] : u.lines.map(at)
            let total = ls.reduce(0) { $0 + $1.width }
            var left = total * k, head = CGPoint(x: r.minX, y: r.maxY)
            let path = CGMutablePath()
            for (li, l) in ls.enumerated() {
                let top = li == 0 ? clip.minY : l.minY - 3, bot = li == ls.count - 1 ? clip.maxY : ls[li + 1].minY - 3
                if left >= l.width { path.addRect(R(clip.minX, top, clip.width, bot - top)); left -= l.width; head = CGPoint(x: l.maxX, y: l.maxY) }
                else { let hx = l.minX + left; path.addRect(R(clip.minX, top, hx - clip.minX, bot - top)); head = CGPoint(x: hx, y: l.maxY - 2); break }
            }
            ctx.saveGState(); ctx.addPath(path); ctx.clip(); image(u.img, clip); ctx.restoreGState()
            offer(head, s)
        default:
            // Borderless boxes, arrows and lines are swept in, left to right.
            let hx = clip.minX + clip.width * easeInOut(k)
            ctx.saveGState(); ctx.clip(to: R(clip.minX, clip.minY, max(1, hx - clip.minX), clip.height)); image(u.img, clip); ctx.restoreGState()
            offer(CGPoint(x: hx, y: r.midY + 6), s)
        }
    }
    for (pi, pin) in b.pins.enumerated() {
        guard let s = p.pinAt[pi] else { continue }
        drawPin(pin, origin: o, k: spring(seg(t, s, s + 0.55)))
        ripple(CGPoint(x: o.x + pin.r.midX, y: o.y + pin.r.midY), seg(t, s, s + 0.6), pin.tone == "o" ? ORANGE2 : TEAL, size: 30)
    }
    for (cr, s, e, col) in p.circles where t >= s {
        let r = at(cr)
        let pts = wobblyEllipse(CGPoint(x: r.midX, y: r.midY), rx: r.width / 2 + 6, ry: r.height / 2 + 4, seed: s)
        let k = easeInOut(seg(t, s, s + 0.45))
        if let h = ink(pts, k, col, width: 4.5, alpha: 1 - seg(t, e, e + 0.3)), k < 1 { offer(h, s) }
    }
    for (pt, s) in p.taps where t >= s && t < s + 0.5 {
        let c = CGPoint(x: o.x + pt.x, y: o.y + pt.y)
        ripple(c, seg(t, s, s + 0.45), ORANGE2, size: 26)
        offer(CGPoint(x: c.x + 8, y: c.y + 6), s, sin(seg(t, s, s + 0.3) * .pi))
    }
    for st in p.stickies {
        guard t >= st.slap, let (img, w, h) = stickyImages[st.unit], let u = b.units.first(where: { $0.i == st.unit }) else { continue }
        let slap = spring(seg(t, st.slap, st.slap + 0.5)), fly = easeInOut(seg(t, st.fly, st.fly + 0.55))
        guard fly < 1 else { continue }
        let home = at(u.r)
        let start = CGRect(x: o.x + st.at.x, y: o.y + st.at.y, width: w, height: h)
        let sc = lerp(1.28, 1, slap)
        let cx = lerp(start.midX, home.midX, fly), cy = lerp(start.midY, home.midY, fly)
        let fw = lerp(w * sc, home.width * 1.05, fly), fh = fw * h / w
        ctx.saveGState()
        ctx.translateBy(x: cx, y: H - cy); ctx.rotate(by: -st.tilt * (1 - fly)); ctx.translateBy(x: -cx, y: -(H - cy))
        image(img, CGRect(x: cx - fw / 2, y: cy - fh / 2, width: fw, height: fh), alpha: clamp(slap * 3) * (1 - seg(fly, 0.6, 1)))
        ctx.restoreGState()
        if slap < 1 { offer(CGPoint(x: start.midX + 40, y: start.maxY - 30), st.slap, 1 - slap) }
    }
    guard let pn = pen, t >= p.penFrom, t <= p.penTo else { return nil }
    return (pn.0, pn.2)
}

/// The wall: the tags card first, then three more boards along it.
let WALL_GAP: CGFloat = 1900
let WALL_ORIGIN = CGPoint.zero
func wallOrigin(_ j: Int) -> CGPoint { CGPoint(x: CGFloat(j + 1) * WALL_GAP, y: 0) }
let M0: CGFloat = B0 + 24.4
let wallPlans: [Plan] = wallBoards.enumerated().map { j, wb in quickPlan(wb.0, from: M0 + 0.6 + CGFloat(j) * 2.5, dur: 1.75) }
let wallEnd: CGFloat = M0 + 0.6 + 3 * 2.5 + 0.2
func fullCard(_ b: Board, _ o: CGPoint) -> (CGFloat, CGPoint) { frameOn(CGRect(x: o.x, y: o.y - 70, width: b.w, height: b.h + 70).insetBy(dx: -30, dy: -24), 1800, 880, cap: 1.2) }
let wallShots: [Shot] = {
    let b = tagsBoard
    func r(_ k: String) -> CGRect { b.parts[k] ?? CGRect(x: 0, y: 0, width: b.w, height: 200) }
    let listR = r("list")
    let open = frameOn(CGRect(x: 20, y: 10, width: 1230, height: 140), 1840, 600, cap: 1.5)
    var s: [Shot] = [
        Shot(at: B0, dur: 0, scale: open.0, focus: open.1),
        shot(B0 + 3.4, 0.9, frameOn(CGRect(x: 20, y: 60, width: 1400, height: 140), 1840, 600, cap: 1.45)),
        shot(B0 + 7.0, 0.8, frameOn(r("before").insetBy(dx: -60, dy: -110), 1500, 760, cap: 1.9)),
        shot(B0 + 9.2, 0.8, frameOn(union([r("before"), r("after")]).insetBy(dx: -40, dy: -100), 1760, 760, cap: 1.7)),
        shot(B0 + 12.5, 0.9, frameOn(CGRect(x: 0, y: r("after").maxY, width: 1060, height: b.h - r("after").maxY).insetBy(dx: -20, dy: -10), 1700, 800, cap: 1.5)),
        shot(B0 + 15.1, 0.9, frameOn(listR.union(CGRect(x: listR.minX - 470, y: listR.minY, width: 470, height: 300)).insetBy(dx: -30, dy: -20), 1600, 800, cap: 1.6)),
        shot(B0 + 19.7, 0.9, frameOn(b.items.suffix(2).reduce(r("try")) { $0.union($1) }.insetBy(dx: -60, dy: -40), 1600, 800, cap: 1.5)),
        shot(B0 + 23.0, 1.2, fullCard(b, WALL_ORIGIN)),
    ]
    for j in 0..<wallBoards.count { s.append(shot(M0 + CGFloat(j) * 2.5, 0.6, fullCard(wallBoards[j].0, wallOrigin(j)))) }
    return s
}()
let wall = Scene(start: B0, end: wallEnd, enter: .cross, dur: 0.45, draw: { t in
    board()
    let at = CGPoint(x: W / 2, y: 468)
    let (s, f) = cam(t, wallShots)
    var penPt: (CGPoint, CGFloat)? = nil
    camera(scale: s, focus: f, at: at) {
        if let pn = drawCard(tagsBoard, origin: WALL_ORIGIN, t: t, plan: tagsP, stickyImages: stickyImgs) { penPt = pn }
        // Every claim checked: three quiet ticks beside the verdict, then gone.
        let vr = tagsBoard.parts["verdict"] ?? .zero, tr = tagsBoard.parts["try"] ?? vr
        var tx = tr.maxX + 40
        for (i, w) in ["code", "tests", "your chat"].enumerated() {
            let a = easeOut(seg(t, B0 + 5.5 + CGFloat(i) * 0.3, B0 + 5.9 + CGFloat(i) * 0.3)) * (1 - easeOut(seg(t, B0 + 7.0, B0 + 7.4)))
            let r = pill("✓ " + w, tx, vr.minY + 1 + (1 - a) * 8, size: 15, fg: TEAL, bg: rgb(0xFFFFFF), alpha: a, font: inter(15, 600))
            stroke(r, TEAL, width: 1.5, radius: r.height / 2, alpha: a * 0.6)
            tx = r.maxX + 10
        }
        guard t > M0 - 0.4 else { return }
        for (j, (wb, label)) in wallBoards.enumerated() {
            let o = wallOrigin(j)
            if let pn = drawCard(wb, origin: o, t: t, plan: wallPlans[j]) { penPt = pn }
            pill(label, o.x, o.y - 62, size: 22, fg: WHITE, bg: INK, alpha: easeOut(seg(t, wallPlans[j].penFrom - 0.3, wallPlans[j].penFrom)), font: inter(22, 700))
        }
    }
    if let (p, press) = penPt { marker(toScreen(p, scale: s, focus: f, at: at), press: press) }
})

// MARK: 7. End card

let E0: CGFloat = wallEnd
let endCard = Scene(start: E0, end: E0 + 7.0, enter: .circle, dur: 0.85, draw: { t in
    board()
    glow(CGPoint(x: W / 2, y: 330), 760, rgb(0xF0752E, 0.07 * easeOut(seg(t, E0, E0 + 1))))
    let m: CGFloat = 132
    let lw = lockup(0, 0, markSize: m, measureOnly: true)
    let badge = width("1.0", inter(30, 700)) + 45
    let x = (W - lw - 26 - badge) / 2, y: CGFloat = 196
    let k = spring(seg(t, E0 + 0.3, E0 + 1.2))
    let wa = easeOut(seg(t, E0 + 0.6, E0 + 1.1))
    lockup(x, y, markSize: m, markK: easeInOut(seg(t, E0 + 0.5, E0 + 1.1)), markScale: 0.4 + 0.6 * k, wordAlpha: wa, wordDX: (1 - wa) * -16)
    let b = spring(seg(t, E0 + 0.95, E0 + 1.6))
    pill("1.0", x + lw + 26, y + m / 2 - 32 + (1 - b) * 12, size: 30, fg: WHITE, bg: ORANGE, alpha: clamp(b * 2), font: inter(30, 700))
    let a2 = easeOut(seg(t, E0 + 1.3, E0 + 1.9))
    text("Differences, told as a story humans understand.", W / 2, 420 + (1 - a2) * 16, inter(50, 600), INK, alpha: a2, align: 0.5, kern: -1)
    let pf = inter(32, 600)
    let items = ["Asked", "Changed", "Might break", "All checked"], cols = [INK, TEAL, ORANGE, TEAL]
    let sep = "   ·   "
    let totalW = items.enumerated().reduce(CGFloat(0)) { $0 + width($1.element, pf) + ($1.offset < items.count - 1 ? width(sep, pf) : 0) }
    var px = (W - totalW) / 2
    for (i, s) in items.enumerated() {
        let ai = easeOut(seg(t, E0 + 1.8 + CGFloat(i) * 0.15, E0 + 2.3 + CGFloat(i) * 0.15))
        px += text(s, px, 520 + (1 - ai) * 10, pf, cols[i], alpha: ai)
        if i < items.count - 1 { px += text(sep, px, 520, pf, FAINT, alpha: ai) }
    }
    let a4 = easeOut(seg(t, E0 + 2.6, E0 + 3.1))
    text("Open source  ·  Claude Code plugin  ·  GitHub Action", W / 2, 612 + (1 - a4) * 10, inter(30, 500), MUTED, alpha: a4, align: 0.5)
    let a5 = spring(seg(t, E0 + 3.0, E0 + 3.8))
    pill("github.com/pulkitnagpal/storydiff", W / 2, 700 + (1 - a5) * 14, size: 30, fg: WHITE, bg: INK, alpha: clamp(a5 * 2), align: 0.5, font: inter(30, 600))
})

let scenes: [Scene] = [hook, turn, authorScene, prScene, wall, endCard]
let total = scenes.last!.end

// The explainer, talking: few lines, short.
say(2.2, 4.6, "No human can read this.", "No human")
say(4.8, TURN0 + 0.1, "So it gets approved anyway.", "approved anyway")
say(TURN0 + 2.6, A0, "Differences, told as a story humans understand.", "a story")
say(A0 + 0.3, PR0, "Done? Type /storydiff.", "/storydiff")
say(PR0 + 0.3, B0 + 0.1, "It's the first comment on the PR.", "first comment")
say(B0 + 0.3, B0 + 3.4, "Here's what \(author) asked.", "asked")
say(B0 + 3.6, B0 + 7.1, "Every claim, checked.", "checked")
say(B0 + 7.3, B0 + 12.6, "Same screen, before and after.", "before and after")
say(B0 + 15.4, B0 + 19.7, "\(author)'s calls, in her own words.", "own words")
say(B0 + 19.9, M0 - 0.1, "Two things I'd try before merging.", "try")
say(M0 + 0.2, wallEnd, "Any kind of PR.", "Any kind")

// MARK: - render

let bytesPerRow = Int(W) * 4
func makeContext(_ data: UnsafeMutableRawPointer?) -> CGContext {
    CGContext(data: data, width: Int(W), height: Int(H), bitsPerComponent: 8, bytesPerRow: bytesPerRow,
              space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
}
/// A drawing context at SS times the frame size, in frame coordinates.
func hiContext() -> CGContext {
    let c = CGContext(data: nil, width: Int(W * SS), height: Int(H * SS), bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
    c.scaleBy(x: SS, y: SS); c.interpolationQuality = .high; c.setShouldAntialias(true)
    return c
}
/// Draws frame t at SS×, then scales it down into the output buffer.
func renderFrame(_ t: CGFloat, into raw: UnsafeMutableRawPointer?) -> CGContext {
    let hi = hiContext(); ctx = hi
    drawFrame(t)
    let img = hi.makeImage()!
    let out = makeContext(raw); out.interpolationQuality = .high
    out.draw(img, in: CGRect(x: 0, y: 0, width: W, height: H))
    return out
}
var frozen: [Int: CGImage] = [:]
/// The last frame of scene i, kept for the transition out of it.
func frozenEnd(_ i: Int) -> CGImage {
    if let f = frozen[i] { return f }
    let saved = ctx
    let c = hiContext(); ctx = c
    scenes[i].draw(scenes[i].end - 0.001)
    let img = c.makeImage()!
    ctx = saved; frozen[i] = img
    return img
}
func full(_ img: CGImage, dx: CGFloat = 0, alpha: CGFloat = 1) { image(img, CGRect(x: dx, y: 0, width: W, height: H), alpha: alpha) }
func drawFrame(_ t: CGFloat) {
    let i = scenes.lastIndex(where: { t >= $0.start }) ?? 0
    let sc = scenes[i]
    let k = sc.dur > 0 ? seg(t, sc.start, sc.start + sc.dur) : 1
    if i == 0 || k >= 1 || sc.enter == .none { sc.draw(t); drawCaptions(t); return }
    let prev = frozenEnd(i - 1), e = easeInOut(k)
    switch sc.enter {
    case .cross:
        sc.draw(t); full(prev, alpha: 1 - e)
    case .pan:
        // The camera steps along the wall.
        ctx.saveGState(); ctx.translateBy(x: W * (1 - e), y: 0); sc.draw(t); ctx.restoreGState()
        full(prev, dx: -W * e)
    case .eraser:
        sc.draw(t)
        let edge = lerp(-160, W + 260, e)
        let clip = CGMutablePath()
        clip.move(to: CGPoint(x: edge, y: -20))
        for j in 0...24 { let y = CGFloat(j) / 24 * (H + 40) - 20; clip.addLine(to: CGPoint(x: edge + 26 * sin(y / 70 + k * 9) + 14 * sin(y / 23), y: y)) }
        clip.addLine(to: CGPoint(x: W + 400, y: H + 20)); clip.addLine(to: CGPoint(x: W + 400, y: -20)); clip.closeSubpath()
        ctx.saveGState(); ctx.addPath(clip); ctx.clip(); full(prev); ctx.restoreGState()
        // The eraser itself, scrubbing up and down as it goes.
        let ey = H / 2 + 330 * sin(k * .pi * 7)
        let er = CGRect(x: edge - 70, y: ey - 120, width: 150, height: 240)
        ctx.saveGState(); ctx.translateBy(x: er.midX, y: H - er.midY); ctx.rotate(by: 0.12 * sin(k * 20)); ctx.translateBy(x: -er.midX, y: -(H - er.midY))
        ctx.setShadow(offset: CGSize(width: 0, height: -16), blur: 34, color: rgb(0x16161A, 0.3))
        box(er, rgb(0x2A2A30), radius: 18)
        ctx.setShadow(offset: .zero, blur: 0, color: nil)
        box(CGRect(x: er.minX, y: er.minY + 150, width: er.width, height: 90), rgb(0xEDEAE3), radius: 16)
        box(CGRect(x: er.minX + 30, y: er.minY + 60, width: 90, height: 8), ORANGE2, radius: 4)
        ctx.restoreGState()
    case .flip:
        // A flip-chart page lifts away over the top, curling as it goes.
        sc.draw(t)
        let lift = H * easeIn(k) * 1.08, curl = 60 * sin(k * .pi)
        let page = CGRect(x: 0, y: -lift, width: W, height: H)
        if page.maxY > 0 {
            ctx.saveGState()
            ctx.setShadow(offset: CGSize(width: 0, height: -24), blur: 60, color: rgb(0x16161A, 0.35 * (1 - k)))
            box(page, PAPER)
            ctx.restoreGState()
            ctx.saveGState(); ctx.clip(to: R(page))
            image(prev, page)
            // The bottom edge lifts first: a soft fold of shade.
            let g = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: [rgb(0x3A2A20, 0), rgb(0x3A2A20, 0.22 * sin(k * .pi))] as CFArray, locations: [0, 1])!
            ctx.drawLinearGradient(g, start: P(CGPoint(x: 0, y: page.maxY - 140 - curl)), end: P(CGPoint(x: 0, y: page.maxY)), options: [])
            ctx.restoreGState()
        }
    case .circle:
        full(prev)
        ctx.saveGState()
        let r = e * 1300
        ctx.addEllipse(in: R(W / 2 - r, 420 - r, 2 * r, 2 * r)); ctx.clip()
        sc.draw(t)
        ctx.restoreGState()
    case .none: sc.draw(t)
    }
    drawCaptions(t)
}

func writePNG(_ img: CGImage, _ url: URL) {
    let d = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(d, img, nil); CGImageDestinationFinalize(d)
}

// The logo files: the mark, and the mark with the wordmark, as SVG (outlined, no fonts needed) and PNG.
if let out = env["FILM_LOGO"] {
    let dir = URL(fileURLWithPath: out)
    func svgPath(_ p: CGPath) -> String {
        var s = ""
        p.applyWithBlock { e in
            let pts = e.pointee.points
            func f(_ q: CGPoint) -> String { String(format: "%.2f %.2f", q.x, q.y) }
            switch e.pointee.type {
            case .moveToPoint: s += "M" + f(pts[0])
            case .addLineToPoint: s += "L" + f(pts[0])
            case .addQuadCurveToPoint: s += "Q" + f(pts[0]) + " " + f(pts[1])
            case .addCurveToPoint: s += "C" + f(pts[0]) + " " + f(pts[1]) + " " + f(pts[2])
            case .closeSubpath: s += "Z"
            @unknown default: break
            }
        }
        return s
    }
    // The wordmark's outlines, in top-left coordinates.
    func wordPath(_ size: CGFloat, originX: CGFloat, baseline: CGFloat) -> CGPath {
        let f = inter(size, 700)
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: "Storydiff", attributes: [.font: f, .kern: size * WORD_KERN]))
        let path = CGMutablePath()
        for run in CTLineGetGlyphRuns(line) as! [CTRun] {
            let n = CTRunGetGlyphCount(run)
            var glyphs = [CGGlyph](repeating: 0, count: n), pos = [CGPoint](repeating: .zero, count: n)
            CTRunGetGlyphs(run, CFRange(location: 0, length: n), &glyphs); CTRunGetPositions(run, CFRange(location: 0, length: n), &pos)
            let rf = (CTRunGetAttributes(run) as NSDictionary)[kCTFontAttributeName] as! CTFont
            for i in 0..<n {
                guard let g = CTFontCreatePathForGlyph(rf, glyphs[i], nil) else { continue }
                var tr = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: originX + pos[i].x, ty: baseline)
                if let c = g.copy(using: &tr) { path.addPath(c) }
            }
        }
        return path
    }
    let inkHex = "#16161A", orangeHex = "#F0752E"
    let (sq, st) = markPaths(512)
    let markSVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\" width=\"512\" height=\"512\"><title>Storydiff</title><path fill=\"\(inkHex)\" d=\"\(svgPath(sq))\"/><path fill=\"\(orangeHex)\" d=\"\(svgPath(st))\"/></svg>\n"
    try! markSVG.write(to: dir.appendingPathComponent("logo-mark.svg"), atomically: true, encoding: .utf8)
    // The lockup: a 200 px mark, the wordmark centred on it.
    let m: CGFloat = 200, size = m * 0.86, gap = m * 0.27, pad: CGFloat = 24
    let cap = CTFontGetCapHeight(inter(size, 700))
    let ww = width("Storydiff", inter(size, 700), kern: size * WORD_KERN)
    let LW = (pad + m + gap + ww + pad).rounded(.up), LH = pad + m + pad
    let (sq2, st2) = markPaths(m)
    var tr = CGAffineTransform(translationX: pad, y: pad)
    let sqL = sq2.copy(using: &tr)!, stL = st2.copy(using: &tr)!
    let word = wordPath(size, originX: pad + m + gap, baseline: pad + m / 2 + cap / 2)
    let lockSVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 \(Int(LW)) \(Int(LH))\" width=\"\(Int(LW))\" height=\"\(Int(LH))\"><title>Storydiff</title><path fill=\"\(inkHex)\" d=\"\(svgPath(sqL))\"/><path fill=\"\(orangeHex)\" d=\"\(svgPath(stL))\"/><path fill=\"\(inkHex)\" d=\"\(svgPath(word))\"/></svg>\n"
    try! lockSVG.write(to: dir.appendingPathComponent("logo.svg"), atomically: true, encoding: .utf8)
    func png(_ w: Int, _ h: Int, _ scale: CGFloat, _ paths: [(CGPath, CGColor)], _ url: URL) {
        let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        c.translateBy(x: 0, y: CGFloat(h)); c.scaleBy(x: scale, y: -scale)
        for (p, col) in paths { c.addPath(p); c.setFillColor(col); c.fillPath() }
        writePNG(c.makeImage()!, url)
    }
    png(512, 512, 1, [(sq, INK), (st, ORANGE2)], dir.appendingPathComponent("logo-mark.png"))
    png(Int(LW * 2), Int(LH * 2), 2, [(sqL, INK), (stL, ORANGE2), (word, INK)], dir.appendingPathComponent("logo.png"))
    FileHandle.standardError.write(Data("wrote logo.svg, logo.png, logo-mark.svg, logo-mark.png to \(dir.path)\n".utf8))
    exit(0)
}

// Each card drawn on the board must end as the real card: compare it with the flat render.
if env["FILM_VERIFY"] != nil {
    for key in ["tags", "infra", "refactor", "big"] {
        let b = loadBoard(key)
        let flat = asset("card-\(key).png")
        let w = flat.width, h = flat.height
        let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        let saved = ctx; ctx = c
        c.translateBy(x: 0, y: CGFloat(h) - H * 2); c.scaleBy(x: 2, y: 2)
        c.setFillColor(PAPER); c.fill(CGRect(x: -10000, y: -10000, width: 30000, height: 30000))
        var p = quickPlan(b, from: 0, dur: 1); p.penTo = -1
        drawCard(b, origin: .zero, t: 100, plan: p)
        ctx = saved
        let mine = c.makeImage()!
        func pixels(_ img: CGImage) -> [UInt8] {
            var d = [UInt8](repeating: 0, count: w * h * 4)
            let cc = CGContext(data: &d, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            cc.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h)); return d
        }
        let a = pixels(mine), bb = pixels(flat)
        var off = 0, sum = 0
        for i in stride(from: 0, to: a.count, by: 4) {
            let d = abs(Int(a[i]) - Int(bb[i])) + abs(Int(a[i + 1]) - Int(bb[i + 1])) + abs(Int(a[i + 2]) - Int(bb[i + 2]))
            sum += d; if d > 60 { off += 1 }
        }
        print(String(format: "%@: %d pieces, %.3f%% of pixels differ visibly, mean diff %.2f", key, b.units.count, Double(off) / Double(w * h) * 100, Double(sum) / Double(w * h)))
        if let d = env["FILM_VERIFY_DIR"] { writePNG(mine, URL(fileURLWithPath: d).appendingPathComponent("drawn-\(key).png")) }
    }
    exit(0)
}

FileHandle.standardError.write(Data("film: \(String(format: "%.1f", total)) s, \(tagsBoard.units.count) pieces on the tags board\n".utf8))
var buffer = [UInt8](repeating: 0, count: bytesPerRow * Int(H))
if let only = env["FILM_ONLY"] {
    let dir = URL(fileURLWithPath: env["FILM_STILLS"] ?? ".")
    for s in only.split(separator: ",") {
        let t = CGFloat(Double(s) ?? 0)
        var img: CGImage? = nil
        buffer.withUnsafeMutableBytes { raw in img = renderFrame(t, into: raw.baseAddress).makeImage() }
        writePNG(img!, dir.appendingPathComponent(env["FILM_NAME"] ?? "still-\(s).png"))
    }
    exit(0)
}
let out = FileHandle.standardOutput
let frameCount = Int(total * FPS)
for f in 0..<frameCount {
    let t = CGFloat(Double(f) / FPS)
    buffer.withUnsafeMutableBytes { raw in _ = renderFrame(t, into: raw.baseAddress) }
    buffer.withUnsafeBytes { out.write(Data($0)) }
    if f % 300 == 0 { FileHandle.standardError.write(Data("frame \(f)/\(frameCount)\n".utf8)) }
}
