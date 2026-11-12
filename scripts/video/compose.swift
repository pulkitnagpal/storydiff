// Composes the Storydiff v1 launch film (scripts/video/make-film.sh runs it).
// Every card, page, diff, handover and check result in the film comes from the assets folder (scripts/video/manifest.json
// lists them; stage.ts makes stand-ins from the Linkbox fixture and runs the real checker). This file only adds the stage:
// camera moves, focus, transitions, typing and type. Writes raw BGRA frames to stdout for ffmpeg.
//
//   compose <assets dir> > frames.raw          (FILM_ONLY=<seconds,...> renders single PNG stills instead, for checking)
import AppKit
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let W: CGFloat = 1920, H: CGFloat = 1080, FPS = 30.0
let A = URL(fileURLWithPath: CommandLine.arguments[1])

// MARK: - palette and type (the card's own colors)

func rgb(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: a)
}
let INK = rgb(0x16161A), BODY = rgb(0x3F3F46), MUTED = rgb(0x6B6B74), FAINT = rgb(0x8E8A84), PAPER = rgb(0xF7F6F3)
let LINE = rgb(0xE6E3DD), ORANGE = rgb(0xC2410C), ORANGE2 = rgb(0xF0752E), TEAL = rgb(0x0F766E), TEALBG = rgb(0xE3F1EF)
let TEALDK = rgb(0x0B4F4A), WATCHBG = rgb(0xFDEBE1), INDIGO = rgb(0x4338CA), RED = rgb(0xB42318), REDBG = rgb(0xFDE2E1), WHITE = rgb(0xFFFFFF)

func sans(_ size: CGFloat, _ weight: NSFont.Weight = .regular) -> CTFont { NSFont.systemFont(ofSize: size, weight: weight) as CTFont }
func mono(_ size: CGFloat, _ weight: NSFont.Weight = .regular) -> CTFont { NSFont.monospacedSystemFont(ofSize: size, weight: weight) as CTFont }

// MARK: - assets

func load(_ name: String) -> CGImage {
    guard let src = CGImageSourceCreateWithURL(A.appendingPathComponent(name) as CFURL, nil),
          let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fatalError("missing asset \(name) (run stage.ts)") }
    return img
}
func json(_ name: String) -> [String: Any] {
    guard let d = try? Data(contentsOf: A.appendingPathComponent(name)),
          let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { fatalError("missing asset \(name) (run stage.ts)") }
    return o
}
func lines(_ name: String) -> [String] {
    guard let s = try? String(contentsOf: A.appendingPathComponent(name), encoding: .utf8) else { fatalError("missing asset \(name)") }
    var l = s.components(separatedBy: "\n"); if l.last == "" { l.removeLast() }
    return l
}
func num(_ v: Any?) -> CGFloat { (v as? NSNumber).map { CGFloat(truncating: $0) } ?? 0 }
func rect(_ v: Any?) -> CGRect? {
    guard let d = v as? [String: Any], d["found"] as? Bool != false else { return nil }
    return CGRect(x: num(d["x"]), y: num(d["y"]), width: num(d["w"]), height: num(d["h"]))
}

struct Pin { let n: Int; let tone: String; let r: CGRect }
struct Card {
    let img: CGImage, cssW: CGFloat, parts: [String: CGRect], items: [CGRect], pins: [Pin]
    var cssH: CGFloat { cssW * CGFloat(img.height) / CGFloat(img.width) }
}
func card(_ key: String, bare: Bool = false) -> Card {
    let j = json("card-\(key).json")
    let full = load("card-\(key)\(bare ? "-bare" : "").png")
    let parts = ((j["parts"] as? [String: Any]) ?? [:]).compactMapValues { rect($0) }
    let sc = num(j["scale"]) > 0 ? num(j["scale"]) : 2
    // Keep only the card itself (the capture can run past it when the card is shorter than the viewport).
    let h = parts["card"].map { min(CGFloat(full.height), ($0.maxY + 2) * sc) } ?? CGFloat(full.height)
    let img = full.cropping(to: CGRect(x: 0, y: 0, width: CGFloat(full.width), height: h)) ?? full
    let pins = ((j["pins"] as? [[String: Any]]) ?? []).compactMap { p -> Pin? in
        guard let r = rect(p) else { return nil }
        return Pin(n: Int(num(p["n"])), tone: (p["tone"] as? String) ?? "g", r: r)
    }
    return Card(img: img, cssW: num(j["width"]) > 0 ? num(j["width"]) : 1440, parts: parts,
                items: ((j["items"] as? [Any]) ?? []).compactMap { rect($0) }, pins: pins)
}

let tagsCard = card("tags", bare: true)
let deck: [(Card, String)] = [(card("tags"), "UI + API"), (card("infra"), "Infra · Docker and CI"),
                              (card("refactor"), "Refactor · proof nothing changed"), (card("big"), "Big PR · in chapters")]
let prImg = load("pr.png"), prJ = json("pr.json")
let prCss = num(prJ["width"]) > 0 ? num(prJ["width"]) : 1280
let prCard = rect(prJ["card"]) ?? CGRect(x: 105, y: 456, width: 1152, height: 864)

struct Check { let ref: String; let kind: String; let ok: Bool?; let why: String; let at: String?; let line: Int }
struct Report { let checks: [Check]; let claims: Int; let failed: Int; let oldPass: Int; let newTests: Int }
func report(_ name: String) -> Report {
    let j = json(name)
    let cs = ((j["checks"] as? [[String: Any]]) ?? []).map {
        Check(ref: ($0["ref"] as? String) ?? "", kind: ($0["kind"] as? String) ?? "proof", ok: $0["ok"] as? Bool,
              why: ($0["why"] as? String) ?? "", at: $0["at"] as? String, line: Int(num($0["line"])))
    }
    return Report(checks: cs, claims: Int(num(j["claims"])), failed: Int(num(j["failed"])), oldPass: Int(num(j["oldPass"])), newTests: Int(num(j["newTests"])))
}
let rep = report("report.json"), repFake = report("report-fake.json")
let handover = lines("handover.storydiff"), handoverFake = lines("handover-fake.storydiff")
let session = json("session.json")
let author = (session["author"] as? String) ?? "Maya"
let diffStat = json("diff.json")

// MARK: - easing

func clamp(_ x: CGFloat, _ a: CGFloat = 0, _ b: CGFloat = 1) -> CGFloat { min(max(x, a), b) }
func seg(_ t: CGFloat, _ a: CGFloat, _ b: CGFloat) -> CGFloat { clamp((t - a) / (b - a)) }
func easeOut(_ t: CGFloat) -> CGFloat { 1 - pow(1 - t, 3) }
func easeInOut(_ t: CGFloat) -> CGFloat { t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2 }
func back(_ t: CGFloat) -> CGFloat { let c1: CGFloat = 1.70158, c3 = c1 + 1; return 1 + c3 * pow(t - 1, 3) + c1 * pow(t - 1, 2) }
func spring(_ t: CGFloat) -> CGFloat { t >= 1 ? 1 : 1 - exp(-6.5 * t) * cos(11 * t) }
func lerp(_ a: CGFloat, _ b: CGFloat, _ t: CGFloat) -> CGFloat { a + (b - a) * t }
func lerpPt(_ a: CGPoint, _ b: CGPoint, _ t: CGFloat) -> CGPoint { CGPoint(x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t)) }

// MARK: - drawing (top-left coordinates)

var ctx: CGContext!
func R(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect { CGRect(x: x, y: H - y - h, width: w, height: h) }
func R(_ r: CGRect) -> CGRect { R(r.minX, r.minY, r.width, r.height) }
func fill(_ c: CGColor) { ctx.setFillColor(c); ctx.fill(CGRect(x: -W, y: -H, width: 3 * W, height: 3 * H)) }
func box(_ r: CGRect, _ c: CGColor, radius: CGFloat = 0, alpha: CGFloat = 1) {
    guard alpha > 0.001 else { return }
    ctx.saveGState(); ctx.setAlpha(alpha)
    ctx.addPath(CGPath(roundedRect: R(r), cornerWidth: radius, cornerHeight: radius, transform: nil)); ctx.setFillColor(c); ctx.fillPath()
    ctx.restoreGState()
}
func stroke(_ r: CGRect, _ c: CGColor, width: CGFloat, radius: CGFloat = 0, alpha: CGFloat = 1, dash: [CGFloat] = []) {
    guard alpha > 0.001 else { return }
    ctx.saveGState(); ctx.setAlpha(alpha); ctx.setStrokeColor(c); ctx.setLineWidth(width)
    if !dash.isEmpty { ctx.setLineDash(phase: 0, lengths: dash) }
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
    ctx.drawRadialGradient(g, startCenter: CGPoint(x: center.x, y: H - center.y), startRadius: 0,
                           endCenter: CGPoint(x: center.x, y: H - center.y), endRadius: radius, options: [])
}
func paper() {
    fill(PAPER)
    glow(CGPoint(x: W * 0.82, y: H * 0.12), 900, rgb(0xF0752E, 0.08))
    glow(CGPoint(x: W * 0.08, y: H * 0.95), 760, rgb(0x0F766E, 0.06))
}

/// An image placed by its top-left corner, with rounded corners and a soft shadow.
func image(_ img: CGImage, _ r: CGRect, alpha: CGFloat = 1, radius: CGFloat = 0, shadow: CGFloat = 0, rotate: CGFloat = 0, scale: CGFloat = 1, clipH: CGFloat? = nil) {
    guard alpha > 0.001 else { return }
    ctx.saveGState(); ctx.setAlpha(alpha)
    let cx = r.midX, cy = r.minY + (clipH ?? r.height) / 2
    ctx.translateBy(x: cx, y: H - cy); ctx.rotate(by: rotate); ctx.scaleBy(x: scale, y: scale); ctx.translateBy(x: -cx, y: -(H - cy))
    let vis = CGRect(x: r.minX, y: r.minY, width: r.width, height: clipH ?? r.height)
    let path = CGPath(roundedRect: R(vis), cornerWidth: radius, cornerHeight: radius, transform: nil)
    if shadow > 0 {
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -14 * shadow), blur: 46 * shadow, color: rgb(0x3A2A20, 0.18))
        ctx.addPath(path); ctx.setFillColor(WHITE); ctx.fillPath(); ctx.restoreGState()
    }
    ctx.addPath(path); ctx.clip()
    ctx.interpolationQuality = .high
    ctx.draw(img, in: R(r))
    ctx.restoreGState()
}
func fitW(_ img: CGImage, _ w: CGFloat) -> CGFloat { w * CGFloat(img.height) / CGFloat(img.width) }

func width(_ s: String, _ f: CTFont) -> CGFloat {
    CGFloat(CTLineGetTypographicBounds(CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: [.font: f])), nil, nil, nil))
}
/// Text placed by the top of its line box. align: 0 left, 0.5 centre, 1 right. Returns the width.
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
/// Runs of differently styled text on one line.
@discardableResult
func runs(_ parts: [(String, CTFont, CGColor)], _ x: CGFloat, _ y: CGFloat, alpha: CGFloat = 1) -> CGFloat {
    var cx = x
    for (s, f, c) in parts { cx += text(s, cx, y, f, c, alpha: alpha) }
    return cx - x
}
func wrap(_ s: String, _ f: CTFont, _ maxW: CGFloat) -> [String] {
    var out: [String] = [], cur = ""
    for word in s.split(separator: " ").map(String.init) {
        let next = cur.isEmpty ? word : cur + " " + word
        if width(next, f) > maxW && !cur.isEmpty { out.append(cur); cur = word } else { cur = next }
    }
    if !cur.isEmpty { out.append(cur) }
    return out
}
func cut(_ s: String, _ n: Int) -> String { s.count <= n ? s : String(s.prefix(n - 1)) + "…" }

/// A caption: a big line rising into place with a smaller line under it, on a white plate when it sits over content.
func caption(_ title: String, _ sub: String?, t: CGFloat, start: CGFloat, end: CGFloat, x: CGFloat = 110, y: CGFloat = 56, plate: Bool = false) {
    let inT = easeOut(seg(t, start, start + 0.6)), out = 1 - easeOut(seg(t, end - 0.4, end))
    let a = inT * out
    guard a > 0.001 else { return }
    let tf = sans(56, .bold), sf = sans(29, .medium)
    if plate {
        let w = max(width(title, tf), sub.map { width($0, sf) } ?? 0) + 64
        ctx.saveGState(); ctx.setAlpha(a * 0.96)
        ctx.setShadow(offset: CGSize(width: 0, height: -8), blur: 30, color: rgb(0x3A2A20, 0.14))
        ctx.addPath(CGPath(roundedRect: R(x - 32, y - 24, w, sub == nil ? 114 : 164), cornerWidth: 22, cornerHeight: 22, transform: nil))
        ctx.setFillColor(WHITE); ctx.fillPath(); ctx.restoreGState()
    }
    text(title, x, y + (1 - inT) * 26, tf, INK, alpha: a, kern: -1)
    if let sub {
        let s = easeOut(seg(t, start + 0.25, start + 0.85)) * out
        text(sub, x, y + 80 + (1 - s) * 20, sf, BODY, alpha: s)
    }
}

@discardableResult
func pill(_ s: String, _ x: CGFloat, _ y: CGFloat, size: CGFloat, fg: CGColor, bg: CGColor, alpha: CGFloat = 1, align: CGFloat = 0, weight: NSFont.Weight = .semibold) -> CGRect {
    let f = sans(size, weight)
    let w = width(s, f) + size * 1.5, h = size * 2.1
    let r = CGRect(x: x - w * align, y: y, width: w, height: h)
    guard alpha > 0.001 else { return r }
    ctx.saveGState(); ctx.setAlpha(alpha)
    ctx.setShadow(offset: CGSize(width: 0, height: -5), blur: 18, color: rgb(0x3A2A20, 0.12))
    ctx.addPath(CGPath(roundedRect: R(r), cornerWidth: h / 2, cornerHeight: h / 2, transform: nil)); ctx.setFillColor(bg); ctx.fillPath()
    ctx.restoreGState()
    text(s, r.minX + size * 0.75, y + (h - CTFontGetAscent(f) - CTFontGetDescent(f)) / 2, f, fg, alpha: alpha)
    return r
}

/// Dims everything except a rounded rectangle and rings it.
func spotlight(_ hole: CGRect, alpha: CGFloat, radius: CGFloat = 14, color: CGColor = ORANGE2, dim: CGFloat = 0.14) {
    guard alpha > 0.001 else { return }
    let p = CGMutablePath()
    p.addRect(CGRect(x: -4 * W, y: -4 * H, width: 9 * W, height: 9 * H))
    p.addPath(CGPath(roundedRect: R(hole), cornerWidth: radius, cornerHeight: radius, transform: nil))
    ctx.saveGState(); ctx.addPath(p); ctx.setFillColor(rgb(0x3A2A20, dim * alpha)); ctx.fillPath(using: .evenOdd); ctx.restoreGState()
    stroke(hole.insetBy(dx: -3, dy: -3), color, width: 3, radius: radius + 3, alpha: 0.85 * alpha)
}

/// Draws everything inside zoomed around `focus`, which lands on `at` on screen.
func camera(scale: CGFloat, focus: CGPoint, at: CGPoint = CGPoint(x: W / 2, y: H / 2), _ draw: () -> Void) {
    ctx.saveGState()
    ctx.translateBy(x: at.x, y: H - at.y); ctx.scaleBy(x: scale, y: scale); ctx.translateBy(x: -focus.x, y: -(H - focus.y))
    draw()
    ctx.restoreGState()
}
struct Shot { let at: CGFloat; let dur: CGFloat; let scale: CGFloat; let focus: CGPoint }
func cam(_ t: CGFloat, _ shots: [Shot]) -> (CGFloat, CGPoint) {
    var s = shots[0].scale, f = shots[0].focus
    for sh in shots.dropFirst() {
        let k = easeInOut(seg(t, sh.at, sh.at + sh.dur))
        if k <= 0 { break }
        // Zoom in log space so pushes and pulls feel even.
        s = exp(lerp(log(s), log(sh.scale), k)); f = lerpPt(f, sh.focus, k)
    }
    return (s, f)
}
/// The scale and centre that frame `r` in a box of maxW × maxH on screen.
func frameOn(_ r: CGRect, _ maxW: CGFloat, _ maxH: CGFloat, cap: CGFloat = 2.6) -> (CGFloat, CGPoint) {
    (min(cap, maxW / r.width, maxH / r.height), CGPoint(x: r.midX, y: r.midY))
}
func shot(_ at: CGFloat, _ dur: CGFloat, _ f: (CGFloat, CGPoint)) -> Shot { Shot(at: at, dur: dur, scale: f.0, focus: f.1) }

func ripple(_ p: CGPoint, _ k: CGFloat, _ color: CGColor = ORANGE2, size: CGFloat = 44) {
    guard k > 0, k < 1 else { return }
    let r = lerp(size * 0.2, size, easeOut(k))
    ctx.saveGState(); ctx.setStrokeColor(color.copy(alpha: 0.6 * (1 - k))!); ctx.setLineWidth(3)
    ctx.strokeEllipse(in: R(p.x - r, p.y - r, 2 * r, 2 * r)); ctx.restoreGState()
}

/// The Storydiff mark, as in the card header: a dark rounded square with an orange line drawn across it.
func logo(_ x: CGFloat, _ y: CGFloat, size: CGFloat, draw k: CGFloat = 1, alpha: CGFloat = 1, scale: CGFloat = 1) {
    guard alpha > 0.001 else { return }
    let u = size / 30
    ctx.saveGState(); ctx.setAlpha(alpha)
    let cx = x + size / 2, cy = y + size / 2
    ctx.translateBy(x: cx, y: H - cy); ctx.scaleBy(x: scale, y: scale); ctx.translateBy(x: -cx, y: -(H - cy))
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -10 * u), blur: 30 * u, color: rgb(0x16161A, 0.22))
    ctx.addPath(CGPath(roundedRect: R(x + u, y + u, 28 * u, 28 * u), cornerWidth: 9 * u, cornerHeight: 9 * u, transform: nil))
    ctx.setFillColor(INK); ctx.fillPath(); ctx.restoreGState()
    if k > 0 {
        let p = CGMutablePath()
        func P(_ a: CGFloat, _ b: CGFloat) -> CGPoint { CGPoint(x: x + a * u, y: H - (y + b * u)) }
        p.move(to: P(7, 19)); p.addCurve(to: P(23, 11), control1: P(11, 13), control2: P(15, 21))
        ctx.setStrokeColor(ORANGE2); ctx.setLineWidth(3.2 * u); ctx.setLineCap(.round)
        let len = 22 * u
        ctx.setLineDash(phase: 0, lengths: [max(0.01, len * k), len * 2])
        ctx.addPath(p); ctx.strokePath()
    }
    ctx.restoreGState()
}

// MARK: - 1. Intro

typealias Scene = (start: CGFloat, end: CGFloat, draw: (CGFloat) -> Void)   // draw gets absolute time t

let intro: Scene = (0, 4.6, { t in
    paper()
    let k = spring(seg(t, 0.2, 1.3))
    let word = "Storydiff", wf = sans(132, .bold)
    let ls: CGFloat = 150, gap: CGFloat = 40, ww = width(word, wf)
    let gx = (W - (ls + gap + ww)) / 2, gy: CGFloat = 340
    logo(gx, gy, size: ls, draw: easeInOut(seg(t, 0.6, 1.4)), alpha: clamp(k * 2), scale: 0.5 + 0.5 * k)
    let w1 = easeOut(seg(t, 0.9, 1.6))
    text(word, gx + ls + gap + (1 - w1) * 30, gy + 4, wf, INK, alpha: w1, kern: -3)
    let tl = easeOut(seg(t, 1.6, 2.3))
    text("Review the story, not the diff.", W / 2, 600 + (1 - tl) * 18, sans(54, .semibold), BODY, alpha: tl, align: 0.5, kern: -0.5)
    let sub = easeOut(seg(t, 2.2, 2.8))
    text("A coding agent hands over its PR the way a person would: one checked card.", W / 2, 690 + (1 - sub) * 12, sans(30, .medium), FAINT, alpha: sub, align: 0.5)
})

// MARK: - 2. The problem: the diff nobody wants to read

struct DRow { let kind: Int; let text: String; let old: Int?; let new: Int?; let y: CGFloat; let h: CGFloat; let adds: Int; let dels: Int }
let diffRows: [DRow] = {
    var out: [DRow] = [], y: CGFloat = 0, o = 0, n = 0, adds = 0, dels = 0
    func add(_ kind: Int, _ text: String, _ old: Int?, _ new: Int?, _ h: CGFloat) {
        out.append(DRow(kind: kind, text: text, old: old, new: new, y: y, h: h, adds: adds, dels: dels)); y += h
    }
    for raw in lines("diff.patch") {
        let l = raw.replacingOccurrences(of: "\t", with: "  ")
        if l.hasPrefix("diff --git ") {
            let file = l.components(separatedBy: " b/").last ?? l
            if !out.isEmpty { y += 18 }
            add(0, file, nil, nil, 46)
        } else if l.hasPrefix("@@") {
            let nums = l.split(separator: " ").filter { $0.hasPrefix("-") || $0.hasPrefix("+") }
            o = Int(nums.first?.dropFirst().split(separator: ",").first ?? "1") ?? 1
            n = Int(nums.dropFirst().first?.dropFirst().split(separator: ",").first ?? "1") ?? 1
            add(1, l, nil, nil, 30)
        } else if l.hasPrefix("+++") || l.hasPrefix("---") || l.hasPrefix("index ") || l.hasPrefix("new file") || l.hasPrefix("deleted file") || l.hasPrefix("\\") {
            continue
        } else if l.hasPrefix("+") { adds += 1; add(2, String(l.dropFirst()), nil, n, 26); n += 1 }
        else if l.hasPrefix("-") { dels += 1; add(3, String(l.dropFirst()), o, nil, 26); o += 1 }
        else if !out.isEmpty { add(4, String(l.dropFirst()), o, n, 26); o += 1; n += 1 }
    }
    return out
}()
let diffHeight = (diffRows.last.map { $0.y + $0.h } ?? 0)

let problem: Scene = (4.6, 12.8, { t in
    paper()
    let win = CGRect(x: 120, y: 214, width: 1680, height: 900)
    let a = easeOut(seg(t, 4.6, 5.3))
    let wy = win.minY + (1 - a) * 60
    let w = CGRect(x: win.minX, y: wy, width: win.width, height: win.height)
    shadowBox(w, radius: 16, alpha: a)
    ctx.saveGState(); ctx.setAlpha(a)
    ctx.addPath(CGPath(roundedRect: R(w), cornerWidth: 16, cornerHeight: 16, transform: nil)); ctx.clip()
    // Header: what the PR adds, counting up as it scrolls past.
    let head: CGFloat = 70
    let view = CGRect(x: w.minX, y: w.minY + head, width: w.width, height: w.height - head)
    let maxScroll = max(0, diffHeight - view.height + 40)
    let p = seg(t, 5.4, 12.5)
    let scroll = maxScroll * pow(p, 2.3)
    let bottom = scroll + view.height
    let seen = diffRows.last(where: { $0.y < bottom }) ?? diffRows.first
    let files = Int(num(diffStat["files"]))
    // Rows.
    let codeF = mono(16), numF = mono(13.5), fileF = mono(16, .semibold)
    for r in diffRows where r.y + r.h > scroll && r.y < bottom {
        let y = view.minY + r.y - scroll
        switch r.kind {
        case 0:
            box(CGRect(x: w.minX + 24, y: y + 4, width: w.width - 48, height: r.h - 6), rgb(0xF6F8FA), radius: 8)
            stroke(CGRect(x: w.minX + 24, y: y + 4, width: w.width - 48, height: r.h - 6), rgb(0xD1D9E0), width: 1, radius: 8)
            text("▾  " + r.text, w.minX + 44, y + 16, fileF, INK)
        case 1:
            box(CGRect(x: w.minX + 24, y: y, width: w.width - 48, height: r.h), rgb(0xDDF4FF, 0.7))
            text(r.text, w.minX + 160, y + 7, mono(14), rgb(0x59636E))
        default:
            let bg: CGColor? = r.kind == 2 ? rgb(0xE6FFEC) : r.kind == 3 ? rgb(0xFFEBE9) : nil
            if let bg { box(CGRect(x: w.minX + 24, y: y, width: w.width - 48, height: r.h), bg) }
            if let o = r.old { text("\(o)", w.minX + 82, y + 6, numF, FAINT, align: 1) }
            if let n = r.new { text("\(n)", w.minX + 136, y + 6, numF, FAINT, align: 1) }
            let sign = r.kind == 2 ? "+" : r.kind == 3 ? "−" : " "
            text(sign, w.minX + 158, y + 3, codeF, r.kind == 2 ? rgb(0x1A7F37) : r.kind == 3 ? rgb(0xCF222E) : FAINT)
            text(cut(r.text, 150), w.minX + 182, y + 3, codeF, rgb(0x1F2328))
        }
    }
    // A thin scrollbar shows how far there is to go.
    let thumbH = max(40, view.height * view.height / max(diffHeight, 1))
    box(CGRect(x: w.maxX - 14, y: view.minY + 8 + (view.height - 16 - thumbH) * (maxScroll > 0 ? scroll / maxScroll : 0), width: 6, height: thumbH), rgb(0x16161A, 0.25), radius: 3)
    box(CGRect(x: w.minX, y: w.minY, width: w.width, height: head), WHITE)
    box(CGRect(x: w.minX, y: w.minY + head - 1, width: w.width, height: 1), rgb(0xD1D9E0))
    text("Files changed", w.minX + 32, w.minY + 22, sans(23, .semibold), INK)
    text("\(files) files", w.minX + 210, w.minY + 25, sans(20, .medium), MUTED)
    let adds = seen?.adds ?? 0, dels = seen?.dels ?? 0
    let cf = mono(26, .bold)
    let dw = text("−\(dels)", w.maxX - 36, w.minY + 19, cf, rgb(0xCF222E), align: 1)
    text("+\(adds)", w.maxX - 60 - dw, w.minY + 19, cf, rgb(0x1A7F37), align: 1)
    ctx.restoreGState()
    caption("The agent wrote it in an hour.", nil, t: t, start: 5.0, end: 12.8, y: 64)
    let s2 = easeOut(seg(t, 7.6, 8.2)) * (1 - easeOut(seg(t, 12.4, 12.8)))
    text("You'll review it all day.", 1810, 78 + (1 - s2) * 18, sans(44, .semibold), ORANGE, alpha: s2, align: 1)
})

// MARK: - the workbench: Claude Code on the left, the handover on the right (beats 3 and 6)

let WB = CGRect(x: 90, y: 214, width: 1740, height: 830)
let TERM = CGRect(x: WB.minX, y: WB.minY + 44, width: 900, height: WB.height - 44)
let EDIT = CGRect(x: WB.minX + 900, y: WB.minY + 44, width: WB.width - 900, height: WB.height - 44)
/// The input box sits under the transcript, like Claude Code's, until the transcript fills the pane.
let INPUT_MAXY = TERM.maxY - 86
let INPUT = CGRect(x: TERM.minX + 26, y: INPUT_MAXY, width: TERM.width - 52, height: 58)
let termF = mono(17.5), termB = mono(17.5, .semibold), termS = sans(18, .medium)

enum TKind { case user, bullet, sub, check, summary, fail }
struct TLine { let at: CGFloat; let kind: TKind; let text: String; var extra = ""; var color: CGColor = INK; var editLine: Int = -1 }
func tHeight(_ l: TLine) -> CGFloat {
    switch l.kind {
    case .user: return CGFloat(wrap(l.text, termF, INPUT.width - 70).count) * 28 + 34
    case .bullet: return CGFloat(wrap(l.text, termF, TERM.width - 90).count) * 28 + 10
    case .sub, .check: return 30
    case .summary, .fail: return 38
    }
}
/// Where each visible terminal line sits at time t, scrolled so the newest is in view, and where the input box is.
func termLayout(_ ls: [TLine], _ t: CGFloat) -> ([(TLine, CGFloat, CGFloat)], CGRect) {
    var y: CGFloat = 0
    var placed: [(TLine, CGFloat, CGFloat)] = []
    for l in ls where t >= l.at {
        let a = easeOut(seg(t, l.at, l.at + 0.18))
        placed.append((l, y, a)); y += tHeight(l) * easeOut(seg(t, l.at, l.at + 0.12))
    }
    let viewTop = TERM.minY + 22, viewH = INPUT_MAXY - 18 - viewTop
    let off = max(0, y - viewH)
    let input = CGRect(x: INPUT.minX, y: min(INPUT_MAXY, viewTop + y + 12), width: INPUT.width, height: INPUT.height)
    return (placed.map { ($0.0, viewTop + $0.1 - off, $0.2) }, input)
}
func checkLabel(_ c: Check) -> String {
    if c.ok == true {
        if c.kind == "said" { return "quote matches what \(author) typed" + (c.at.map { " · \($0)" } ?? "") }
        return c.ref.hasPrefix("test ") ? "test passes" : "line found in the code"
    }
    if c.kind == "said" { return "not in the session" }
    return c.why
}
func checkRef(_ c: Check) -> String { c.kind == "said" ? "“" + cut(c.ref, 30) + "”" : cut(c.ref, 34) }
/// The handover line a check is about.
func specLine(_ c: Check, in spec: [String]) -> Int {
    let needle = c.kind == "said" ? "\"\(c.ref)\"" : "proof \(c.ref)"
    return spec.firstIndex(where: { $0.contains(needle) }) ?? max(0, c.line - 1)
}
func drawTerm(_ ls: [TLine], _ t: CGFloat) {
    ctx.saveGState(); ctx.clip(to: R(TERM.minX, TERM.minY, TERM.width, INPUT_MAXY - 10 - TERM.minY))
    for (l, y, a) in termLayout(ls, t).0 {
        let x = TERM.minX + 30
        switch l.kind {
        case .user:
            let rows = wrap(l.text, termF, INPUT.width - 70)
            box(CGRect(x: x - 6, y: y, width: INPUT.width, height: CGFloat(rows.count) * 28 + 20), rgb(0xF1EFEB), radius: 10, alpha: a)
            for (i, r) in rows.enumerated() {
                if i == 0 { text(">", x + 12, y + 10, termB, FAINT, alpha: a) }
                text(r, x + 40, y + 10 + CGFloat(i) * 28, termF, INK, alpha: a)
            }
        case .bullet:
            let rows = wrap(l.text, termF, TERM.width - 90)
            text("⏺", x, y + 1, termF, l.color, alpha: a)
            for (i, r) in rows.enumerated() {
                runs(i == 0 && !l.extra.isEmpty ? [(r, termB, INK)] : [(r, termF, INK)], x + 30, y + CGFloat(i) * 28, alpha: a)
            }
        case .sub:
            text("⎿", x + 12, y, termF, FAINT, alpha: a)
            text(l.text, x + 42, y, termF, MUTED, alpha: a)
        case .check:
            let ok = l.color == TEAL
            if !ok { box(CGRect(x: x + 30, y: y - 3, width: TERM.width - 84, height: 30), REDBG, radius: 6, alpha: a) }
            text(ok ? "✓" : "✗", x + 42, y, termB, ok ? TEAL : RED, alpha: a)
            text(l.text, x + 72, y, termF, ok ? INK : RED, alpha: a)
            text(l.extra, x + 72 + 34 * 10.6 + 24, y + 1, termS, ok ? MUTED : RED, alpha: a)
        case .summary, .fail:
            text(l.text, x, y + 6, mono(19, .bold), l.kind == .fail ? RED : TEAL, alpha: a)
        }
    }
    ctx.restoreGState()
}
func drawInput(_ INPUT: CGRect, _ typed: String, _ t: CGFloat) {
    box(INPUT, WHITE, radius: 12)
    stroke(INPUT, rgb(0xD6D3CD), width: 1.5, radius: 12)
    text(">", INPUT.minX + 20, INPUT.minY + 17, termB, FAINT)
    let w = text(typed, INPUT.minX + 50, INPUT.minY + 17, termF, INK)
    if Int(t * 2.2) % 2 == 0 { box(CGRect(x: INPUT.minX + 52 + w, y: INPUT.minY + 15, width: 10, height: 26), rgb(0x16161A, 0.55)) }
    if typed.isEmpty { text("Ask Claude to change something", INPUT.minX + 70, INPUT.minY + 18, termF, rgb(0xB9B5AE)) }
}

/// One handover line, coloured the way an editor would.
func specRuns(_ l: String) -> [(String, CTFont, CGColor)] {
    let f = mono(15.5), b = mono(15.5, .semibold)
    let indent = String(l.prefix(while: { $0 == " " }))
    let body = String(l.dropFirst(indent.count))
    guard let first = body.split(separator: " ", maxSplits: 1).first.map(String.init) else { return [(l, f, INK)] }
    let rest = String(body.dropFirst(first.count))
    let head: CGColor
    switch first {
    case "+": head = TEAL
    case "=": head = MUTED
    case "!": head = ORANGE
    case "~": head = INDIGO
    case "proof", "pin": head = FAINT
    case "said": head = ORANGE
    default: head = INK
    }
    var out: [(String, CTFont, CGColor)] = [(indent + first, b, head)]
    // Quoted strings in teal, the rest in body colour.
    var cur = "", inQ = false
    for ch in rest {
        if ch == "\"" {
            if inQ { cur.append(ch); out.append((cur, f, TEALDK)); cur = "" } else { out.append((cur, f, BODY)); cur = String(ch) }
            inQ.toggle()
        } else { cur.append(ch) }
    }
    out.append((cur, f, inQ ? TEALDK : BODY))
    return out
}
struct EditState { var lines: [String]; var shown: CGFloat; var focus: CGFloat; var marks: [Int: (CGColor, CGFloat)]; var insert: (Int, CGFloat, CGFloat)? = nil }
let LH: CGFloat = 24
func editTop() -> CGFloat { EDIT.minY + 54 }
/// y of line i (before scroll), counting a line being inserted by its growing height.
func lineY(_ i: Int, _ s: EditState) -> CGFloat {
    var y = CGFloat(i) * LH
    if let ins = s.insert, i > ins.0 { y -= LH * (1 - ins.1) }
    return y
}
func editScroll(_ s: EditState) -> CGFloat {
    let viewH = EDIT.height - 70
    let total = CGFloat(s.lines.count) * LH
    return clamp(s.focus * LH - viewH * 0.55, 0, max(0, total - viewH + 10))
}
func drawEditor(_ s: EditState, _ t: CGFloat) {
    box(EDIT, rgb(0xFBFAF8))
    box(CGRect(x: EDIT.minX, y: EDIT.minY, width: EDIT.width, height: 42), rgb(0xF1EFEB))
    box(CGRect(x: EDIT.minX, y: EDIT.minY, width: 250, height: 42), rgb(0xFBFAF8))
    text("handover.storydiff", EDIT.minX + 22, EDIT.minY + 11, sans(17, .semibold), INK)
    let scroll = editScroll(s)
    ctx.saveGState(); ctx.clip(to: R(EDIT.minX, EDIT.minY + 46, EDIT.width, EDIT.height - 46))
    let full = Int(s.shown)
    for (i, l) in s.lines.enumerated() where i <= full {
        let y = editTop() + lineY(i, s) - scroll
        guard y > EDIT.minY - LH, y < EDIT.maxY else { continue }
        var a: CGFloat = 1, chars = l.count
        if i == full { chars = Int(CGFloat(l.count) * (s.shown - CGFloat(full))); if chars == 0 { continue } }
        if let ins = s.insert, ins.0 == i { a = ins.1; chars = Int(CGFloat(l.count) * ins.2) }
        if let (c, k) = s.marks[i], k > 0.001 { box(CGRect(x: EDIT.minX + 6, y: y - 3, width: EDIT.width - 12, height: LH), c, radius: 5, alpha: k * a) }
        text("\(i + 1)", EDIT.minX + 46, y + 2, mono(13), rgb(0xB9B5AE), alpha: a, align: 1)
        runs(specRuns(String(l.prefix(chars))), EDIT.minX + 64, y, alpha: a)
    }
    ctx.restoreGState()
}
func drawBench(_ t: CGFloat, alpha: CGFloat, term: [TLine], typed: String, edit: EditState) {
    shadowBox(WB, radius: 18, alpha: alpha)
    ctx.saveGState(); ctx.setAlpha(alpha)
    ctx.addPath(CGPath(roundedRect: R(WB), cornerWidth: 18, cornerHeight: 18, transform: nil)); ctx.clip()
    box(WB, WHITE)
    box(CGRect(x: WB.minX, y: WB.minY, width: WB.width, height: 44), rgb(0xF4F2EE))
    for i in 0..<3 { box(CGRect(x: WB.minX + 20 + CGFloat(i) * 22, y: WB.minY + 16, width: 13, height: 13), rgb(0xD6D3CD), radius: 6.5) }
    text("\((session["project"] as? String) ?? "linkbox") — Claude Code", WB.midX, WB.minY + 12, sans(16, .medium), MUTED, align: 0.5)
    drawTerm(term, t)
    drawInput(termLayout(term, t).1, typed, t)
    drawEditor(edit, t)
    box(CGRect(x: EDIT.minX, y: EDIT.minY, width: 1, height: EDIT.height), LINE)
    ctx.restoreGState()
}

// MARK: - 3. The author: the session finishes and /storydiff hands it over

let workDone: [TLine] = {
    var ls: [TLine] = [TLine(at: -1, kind: .user, text: (session["prompt"] as? String) ?? "")]
    let work = (session["work"] as? [String]) ?? []
    ls.append(TLine(at: 13.0, kind: .bullet, text: "Edited \(work.count) files", extra: "b", color: TEAL))
    for (i, w) in work.enumerated() {
        let p = w.components(separatedBy: "  ")
        ls.append(TLine(at: 13.15 + CGFloat(i) * 0.12, kind: .sub, text: p.count > 1 ? "\(p[0]) · \(p[1]) lines" : w))
    }
    ls.append(TLine(at: 13.8, kind: .bullet, text: "npm test", extra: "b", color: TEAL))
    ls.append(TLine(at: 14.0, kind: .sub, text: "\(rep.oldPass + rep.newTests) tests pass · 0 fail"))
    let did = handover.first(where: { $0.hasPrefix("did") }).flatMap { $0.split(separator: "\"").dropFirst().first.map(String.init) } ?? ""
    ls.append(TLine(at: 14.4, kind: .bullet, text: did, color: INK))
    return ls
}()
let TYPE0: CGFloat = 15.0, ENTER: CGFloat = 16.2, WRITE0: CGFloat = 16.7, WRITE1: CGFloat = 20.3, CHECK0: CGFloat = 21.2, CHECKDT: CGFloat = 0.38
func checkLines(_ r: Report, spec: [String], from: CGFloat, dt: CGFloat) -> [TLine] {
    r.checks.enumerated().map { i, c in
        TLine(at: from + CGFloat(i) * dt, kind: .check, text: checkRef(c), extra: checkLabel(c), color: c.ok == true ? TEAL : RED, editLine: specLine(c, in: spec))
    }
}
let authorTerm: [TLine] = workDone + [
    TLine(at: ENTER, kind: .user, text: "/storydiff"),
    TLine(at: ENTER + 0.4, kind: .bullet, text: "Writing handover.storydiff", extra: "b", color: TEAL),
    TLine(at: WRITE1, kind: .sub, text: "\(handover.count) lines, from the diff, the tests and this session"),
    TLine(at: CHECK0 - 0.4, kind: .bullet, text: "storydiff check", extra: "b", color: TEAL),
] + checkLines(rep, spec: handover, from: CHECK0, dt: CHECKDT) + [
    TLine(at: CHECK0 + CGFloat(rep.checks.count) * CHECKDT + 0.3, kind: rep.failed == 0 ? .summary : .fail,
          text: rep.failed == 0 ? "✓ \(rep.claims) claims hold up · 0 failed" : "✗ \(rep.failed) of \(rep.claims) claims failed"),
    TLine(at: CHECK0 + CGFloat(rep.checks.count) * CHECKDT + 0.5, kind: .sub, text: "\(rep.oldPass) old tests still pass · \(rep.newTests) new tests"),
]
func marks(_ ls: [TLine], _ t: CGFloat) -> [Int: (CGColor, CGFloat)] {
    var m: [Int: (CGColor, CGFloat)] = [:]
    for l in ls where l.kind == .check && l.editLine >= 0 && t >= l.at {
        let ok = l.color == TEAL
        let flash = 1 - easeOut(seg(t, l.at + 0.15, l.at + 0.9))
        m[l.editLine] = ok ? (TEALBG, 0.55 + 0.45 * flash) : (REDBG, 1)
    }
    return m
}
/// The editor follows the check being made.
func checkFocus(_ ls: [TLine], _ t: CGFloat, start: CGFloat) -> CGFloat {
    var f = start
    for l in ls where l.kind == .check && l.editLine >= 0 {
        f = lerp(f, CGFloat(l.editLine), easeInOut(seg(t, l.at - 0.3, l.at)))
    }
    return f
}

let authorScene: Scene = (12.8, 31.0, { t in
    paper()
    let typedN = Int(clamp((t - TYPE0) / 0.09, 0, 10))
    let typed = t >= ENTER ? "" : String("/storydiff".prefix(typedN))
    let shown = t < WRITE0 ? -1 : CGFloat(handover.count) * seg(t, WRITE0, WRITE1)
    let writeFocus = min(shown, CGFloat(handover.count - 1))
    let edit = EditState(lines: handover, shown: shown, focus: t < CHECK0 - 0.6 ? writeFocus : checkFocus(authorTerm, t, start: writeFocus), marks: marks(authorTerm, t))
    let at = CGPoint(x: W / 2, y: WB.midY)
    let inputAt = termLayout(authorTerm, TYPE0).1
    let (s, f) = cam(t, [
        Shot(at: 12.8, dur: 0, scale: 1, focus: at),
        shot(14.7, 0.8, (1.5, CGPoint(x: TERM.midX, y: inputAt.midY - 150))),
        shot(16.4, 1.0, (1.32, CGPoint(x: EDIT.midX, y: EDIT.midY + 10))),
        shot(CHECK0 - 0.9, 0.9, (1.0, at)),
    ])
    camera(scale: s, focus: f, at: at) {
        drawBench(t, alpha: easeOut(seg(t, 12.8, 13.3)), term: authorTerm, typed: typed, edit: edit)
        ripple(CGPoint(x: inputAt.minX + 140, y: inputAt.midY), seg(t, ENTER - 0.1, ENTER + 0.5), TEAL)
    }
    caption("The agent hands over its own work.", "Type /storydiff. The handover writes itself.", t: t, start: 13.1, end: CHECK0 - 0.8, plate: true)
    caption("Then every line is checked.", "Against the code, the tests, and what \(author) typed.", t: t, start: CHECK0 - 0.6, end: 31.0, plate: true)
})

// MARK: - 4. The reviewer: the PR, with the card as the first comment

let PAGE_W: CGFloat = 1440
let pageK = PAGE_W / prCss
let pageX = (W - PAGE_W) / 2, pageY: CGFloat = 196
func pageRect(_ r: CGRect) -> CGRect { CGRect(x: pageX + r.minX * pageK, y: pageY + r.minY * pageK, width: r.width * pageK, height: r.height * pageK) }
let cardFrame = pageRect(prCard.insetBy(dx: 1, dy: 1))
let cardK = cardFrame.width / tagsCard.cssW
func onCard(_ r: CGRect) -> CGRect { CGRect(x: cardFrame.minX + r.minX * cardK, y: cardFrame.minY + r.minY * cardK, width: r.width * cardK, height: r.height * cardK) }
func part(_ k: String) -> CGRect { onCard(tagsCard.parts[k] ?? CGRect(x: 0, y: 0, width: tagsCard.cssW, height: 200)) }
func union(_ rs: [CGRect]) -> CGRect { rs.dropFirst().reduce(rs.first ?? .zero) { $0.union($1) } }

func drawPin(_ p: Pin, k: CGFloat, alpha: CGFloat = 1) {
    guard k > 0.001 else { return }
    let r = onCard(p.r)
    let c = CGPoint(x: r.midX, y: r.midY), d = r.width * (0.4 + 0.6 * k)
    let fillC: CGColor = ["g": TEAL, "o": ORANGE, "c": INDIGO, "x": FAINT, "k": WHITE][p.tone] ?? TEAL
    ctx.saveGState(); ctx.setAlpha(clamp(k * 2) * alpha)
    ctx.setShadow(offset: CGSize(width: 0, height: -2), blur: 8, color: rgb(0x16161A, 0.25))
    ctx.setFillColor(WHITE); ctx.fillEllipse(in: R(c.x - d / 2 - 3 * cardK, c.y - d / 2 - 3 * cardK, d + 6 * cardK, d + 6 * cardK))
    ctx.restoreGState()
    ctx.saveGState(); ctx.setAlpha(clamp(k * 2) * alpha)
    ctx.setFillColor(fillC); ctx.fillEllipse(in: R(c.x - d / 2, c.y - d / 2, d, d))
    if p.tone == "k" {
        ctx.setStrokeColor(FAINT); ctx.setLineWidth(1.5 * cardK); ctx.setLineDash(phase: 0, lengths: [3 * cardK, 2.5 * cardK])
        ctx.strokeEllipse(in: R(c.x - d / 2, c.y - d / 2, d, d))
    }
    ctx.restoreGState()
    let f = sans(13 * cardK * (0.4 + 0.6 * k), .bold)
    text("\(p.n)", c.x, c.y - (CTFontGetAscent(f) + CTFontGetDescent(f)) / 2, f, p.tone == "k" ? MUTED : WHITE, alpha: clamp(k * 2) * alpha, align: 0.5)
}

let ASK0: CGFloat = 33.4, SHOW0: CGFloat = 36.8, LIST0: CGFloat = 41.6, TRY0: CGFloat = 45.6
let screens = part("screens")
let screenPins = tagsCard.pins.filter { screens.insetBy(dx: -30, dy: -30).contains(CGPoint(x: onCard($0.r).midX, y: onCard($0.r).midY)) }
let otherPins = tagsCard.pins.filter { p in !screenPins.contains(where: { $0.r == p.r }) }
let watchItems = Array(tagsCard.items.suffix(2)).map(onCard)

let reviewer: Scene = (31.0, 51.0, { t in
    paper()
    let at = CGPoint(x: W / 2, y: 500)
    let (s, f) = cam(t, [
        Shot(at: 31.0, dur: 0, scale: 1.0, focus: CGPoint(x: W / 2, y: 470)),
        shot(ASK0 - 0.5, 1.1, frameOn(union([part("header"), part("asked")]).insetBy(dx: -30, dy: -26), 1700, 560, cap: 1.9)),
        shot(SHOW0 - 0.4, 1.1, frameOn(screens.insetBy(dx: -24, dy: -20), 1640, 640)),
        shot(LIST0 - 0.3, 1.1, frameOn(part("list").insetBy(dx: -30, dy: -20), 1200, 720, cap: 2.0)),
        shot(TRY0 - 0.2, 1.0, frameOn(part("verdict").insetBy(dx: -20, dy: -60), 1700, 400, cap: 1.9)),
        shot(TRY0 + 2.0, 1.1, frameOn(union(watchItems).insetBy(dx: -40, dy: -60), 1400, 500, cap: 2.4)),
    ])
    let a = easeOut(seg(t, 31.0, 31.7))
    camera(scale: s, focus: f, at: at) {
        // The browser window holding the PR page.
        let page = CGRect(x: pageX, y: pageY + (1 - a) * 80, width: PAGE_W, height: fitW(prImg, PAGE_W))
        let chrome = CGRect(x: page.minX, y: page.minY - 52, width: page.width, height: page.height + 52)
        shadowBox(chrome, radius: 16, alpha: a)
        ctx.saveGState(); ctx.setAlpha(a)
        ctx.addPath(CGPath(roundedRect: R(chrome), cornerWidth: 16, cornerHeight: 16, transform: nil)); ctx.clip()
        box(CGRect(x: chrome.minX, y: chrome.minY, width: chrome.width, height: 52), rgb(0xF1EFEB))
        for i in 0..<3 { box(CGRect(x: chrome.minX + 22 + CGFloat(i) * 22, y: chrome.minY + 20, width: 13, height: 13), rgb(0xD6D3CD), radius: 6.5) }
        box(CGRect(x: chrome.midX - 260, y: chrome.minY + 11, width: 520, height: 30), WHITE, radius: 15)
        text("linkbox · Pull request #12", chrome.midX, chrome.minY + 17, sans(15, .medium), MUTED, align: 0.5)
        image(prImg, page)
        // The card itself, sharp at any zoom; the film pops its pins in.
        let cf = CGRect(x: cardFrame.minX, y: cardFrame.minY + (1 - a) * 80, width: cardFrame.width, height: fitW(tagsCard.img, cardFrame.width))
        image(tagsCard.img, cf)
        ctx.restoreGState()
        for (i, p) in screenPins.enumerated() {
            let st = SHOW0 + 0.9 + CGFloat(i) * 0.28
            drawPin(p, k: spring(seg(t, st, st + 0.6)))
            let r = onCard(p.r)
            ripple(CGPoint(x: r.midX, y: r.midY), seg(t, st, st + 0.7), p.tone == "o" ? ORANGE2 : TEAL, size: 30)
        }
        for (i, p) in otherPins.enumerated() { drawPin(p, k: spring(seg(t, LIST0 - 0.4 + CGFloat(i) * 0.1, LIST0 + 0.3 + CGFloat(i) * 0.1))) }
        // The list, item by item.
        for (i, it) in tagsCard.items.prefix(tagsCard.items.count - 2).enumerated() {
            let st = LIST0 + 0.9 + CGFloat(i) * 0.6
            let k = easeOut(seg(t, st, st + 0.25)) * (1 - easeOut(seg(t, st + 0.55, st + 0.85)))
            stroke(onCard(it).insetBy(dx: -2, dy: -1), TEAL, width: 2.5, radius: 12, alpha: k)
        }
        // 2 things to try: the chip, then the two items.
        spotlight(part("try").insetBy(dx: -4, dy: -4), alpha: easeOut(seg(t, TRY0 + 0.7, TRY0 + 1.0)) * (1 - easeOut(seg(t, TRY0 + 1.9, TRY0 + 2.2))), radius: 14)
        spotlight(union(watchItems).insetBy(dx: -6, dy: -6), alpha: easeOut(seg(t, TRY0 + 3.0, TRY0 + 3.4)), radius: 16)
    }
    caption("The reviewer opens the PR.", "The card is the first comment.", t: t, start: 31.3, end: ASK0, x: 110, y: 830, plate: true)
    caption("What was asked. What was done.", "In \(author)'s words, then the agent's.", t: t, start: ASK0 + 0.4, end: SHOW0, x: 110, y: 830, plate: true)
    caption("Spot the difference.", "Both versions, captured. Pins mark what changed.", t: t, start: SHOW0 + 0.4, end: LIST0, x: 110, y: 830, plate: true)
    caption("Every change, numbered.", "Each one backed by code, a test, or \(author)'s own words.", t: t, start: LIST0 + 0.4, end: TRY0, x: 110, y: 830, plate: true)
    caption("2 things to try.", "What nobody has checked yet. Before you merge.", t: t, start: TRY0 + 0.4, end: 51.0, x: 110, y: 830, plate: true)
})

// MARK: - 5. Any kind of PR

let DECK0: CGFloat = 51.0, DECKDT: CGFloat = 1.35, GRID0: CGFloat = 56.5
let montage: Scene = (51.0, 58.6, { t in
    paper()
    let big = CGRect(x: (W - 1280) / 2, y: 224, width: 1280, height: 0)
    let cellW: CGFloat = 820, cellH: CGFloat = 388
    let g = easeInOut(seg(t, GRID0, GRID0 + 0.9))
    for (i, (c, label)) in deck.enumerated() {
        let st = DECK0 + CGFloat(i) * DECKDT
        guard t >= st else { continue }
        let k = spring(seg(t, st, st + 0.8))
        let covered = i < deck.count - 1 ? easeOut(seg(t, st + DECKDT, st + DECKDT + 0.5)) : 0
        // Deck position: flies in from the right, then settles back as the next one lands.
        let dx = (1 - k) * 900, sc = 1 - 0.06 * covered
        let deckR = CGRect(x: big.minX + dx, y: big.minY - 20 * covered, width: big.width, height: fitW(c.img, big.width))
        let col = CGFloat(i % 2), row = CGFloat(i / 2)
        let gridR = CGRect(x: 120 + col * (cellW + 40), y: 222 + row * (cellH + 36), width: cellW, height: fitW(c.img, cellW))
        let r = CGRect(x: lerp(deckR.minX, gridR.minX, g), y: lerp(deckR.minY, gridR.minY, g),
                       width: lerp(deckR.width, gridR.width, g), height: lerp(deckR.height, gridR.height, g))
        let clipH = lerp(min(deckR.height, 800), cellH, g)
        image(c.img, r, alpha: clamp(k * 2) * (1 - 0.25 * covered * (1 - g)), radius: 16, shadow: 1, rotate: (1 - k) * 0.05, scale: lerp(sc, 1, g), clipH: clipH)
        let pa = clamp(k * 2) * (1 - covered * (1 - g))
        pill(label, r.minX + 18, r.minY + 16, size: lerp(22, 18, g), fg: WHITE, bg: INK, alpha: pa)
        if i == 3, let ch = c.parts["chapters"] {
            let cr = CGRect(x: r.minX + ch.minX * r.width / c.cssW, y: r.minY + ch.minY * r.width / c.cssW, width: ch.width * r.width / c.cssW, height: ch.height * r.width / c.cssW)
            stroke(cr.insetBy(dx: -4, dy: -4), ORANGE2, width: 3, radius: 12, alpha: easeOut(seg(t, st + 0.6, st + 0.9)) * (1 - g))
        }
    }
    caption("Any kind of PR.", nil, t: t, start: 51.2, end: 58.6, y: 70)
    let s = easeOut(seg(t, GRID0 + 0.5, GRID0 + 1.0)) * (1 - easeOut(seg(t, 58.2, 58.6)))
    text("UI and API changes, infra, refactors, and big ones in chapters.", 1810, 90 + (1 - s) * 14, sans(29, .medium), BODY, alpha: s, align: 1)
})

// MARK: - 6. It can't fib: a planted quote turns red

let fakeIdx = repFake.checks.first(where: { $0.ok != true }).map { specLine($0, in: handoverFake) } ?? 0
let FIB0: CGFloat = 58.6, PLANT0: CGFloat = 59.2, PLANT1: CGFloat = 60.5, RECHECK0: CGFloat = 61.3, RECHECKDT: CGFloat = 0.13
let fibTerm: [TLine] = authorTerm.map { var l = $0; l = TLine(at: -1, kind: l.kind, text: l.text, extra: l.extra, color: l.color, editLine: -1); return l } + [
    TLine(at: RECHECK0 - 0.35, kind: .bullet, text: "storydiff check", extra: "b", color: TEAL),
] + checkLines(repFake, spec: handoverFake, from: RECHECK0, dt: RECHECKDT) + [
    TLine(at: RECHECK0 + CGFloat(repFake.checks.count) * RECHECKDT + 0.3, kind: repFake.failed == 0 ? .summary : .fail,
          text: repFake.failed == 0 ? "✓ \(repFake.claims) claims hold up" : "✗ \(repFake.failed) of \(repFake.claims) claims failed: a quote is not in the session"),
]
let fibRed = fibTerm.last(where: { $0.kind == .check && $0.color == RED })

let fib: Scene = (58.6, 66.0, { t in
    paper()
    let ins = easeOut(seg(t, PLANT0, PLANT0 + 0.3)), typedK = seg(t, PLANT0 + 0.25, PLANT1)
    var m = marks(fibTerm, t)
    if m[fakeIdx] == nil && t >= PLANT0 { m[fakeIdx] = (WATCHBG, ins) }
    for (k, v) in marks(authorTerm, 99) where m[k] == nil && k != fakeIdx { m[k] = (TEALBG, v.1 * 0.8) }
    let edit = EditState(lines: handoverFake, shown: CGFloat(handoverFake.count), focus: CGFloat(fakeIdx), marks: m, insert: (fakeIdx, ins, typedK))
    let at = CGPoint(x: W / 2, y: WB.midY)
    let lineAt = CGPoint(x: EDIT.minX + 360, y: editTop() + lineY(fakeIdx, edit) - editScroll(edit) + 10)
    let redY: CGFloat = fibRed.flatMap { r in termLayout(fibTerm, 64.2).0.first(where: { $0.0.at == r.at })?.1 } ?? TERM.midY
    let (s, f) = cam(t, [
        Shot(at: FIB0, dur: 0, scale: 1.45, focus: CGPoint(x: lineAt.x, y: lineAt.y + 40)),
        shot(RECHECK0 - 0.6, 0.8, (1.0, at)),
        shot(RECHECK0 + 2.0, 0.9, (1.45, CGPoint(x: TERM.minX + 470, y: min(redY + 40, INPUT_MAXY - 230)))),
    ])
    camera(scale: s, focus: f, at: at) {
        drawBench(t, alpha: 1, term: fibTerm, typed: "", edit: edit)
        if t >= PLANT0 {
            let failed = t >= (fibRed?.at ?? 99)
            pill(failed ? "✗ not in the session" : "planted", EDIT.maxX - 24, lineAt.y - 26, size: 15, fg: WHITE, bg: failed ? RED : ORANGE,
                 alpha: ins * (1 - easeOut(seg(t, RECHECK0 + 1.9, RECHECK0 + 2.3))), align: 1)
        }
        if let r = fibRed, let y = termLayout(fibTerm, t).0.first(where: { $0.0.at == r.at })?.1 {
            ripple(CGPoint(x: TERM.minX + 86, y: y + 12), seg(t, r.at, r.at + 0.7), RED, size: 40)
        }
    }
    caption("It can't fib.", "We planted a quote \(author) never typed. The checker caught it.", t: t, start: FIB0 + 0.2, end: 66.0, plate: true)
})

// MARK: - 7. End card

let outro: Scene = (66.0, 72.5, { t in
    paper()
    let k = spring(seg(t, 66.1, 67.1))
    let word = "Storydiff", wf = sans(110, .bold)
    let ls: CGFloat = 124, gap: CGFloat = 34, ww = width(word, wf)
    let gx = (W - (ls + gap + ww)) / 2, gy: CGFloat = 250
    logo(gx, gy, size: ls, draw: easeInOut(seg(t, 66.4, 67.1)), alpha: clamp(k * 2), scale: 0.5 + 0.5 * k)
    let w1 = easeOut(seg(t, 66.5, 67.1))
    text(word, gx + ls + gap, gy + 2 + (1 - w1) * 24, wf, INK, alpha: w1, kern: -2.5)
    let a2 = easeOut(seg(t, 66.9, 67.5))
    text("Review the story, not the diff.", W / 2, 470 + (1 - a2) * 16, sans(50, .semibold), BODY, alpha: a2, align: 0.5, kern: -0.5)
    let a3 = easeOut(seg(t, 67.3, 67.9))
    text("Open source  ·  Claude Code plugin  ·  GitHub Action", W / 2, 572 + (1 - a3) * 12, sans(32, .medium), MUTED, alpha: a3, align: 0.5)
    let a4 = spring(seg(t, 67.7, 68.5))
    pill("github.com/pulkitnagpal/storydiff", W / 2, 676 + (1 - a4) * 16, size: 30, fg: WHITE, bg: INK, alpha: clamp(a4 * 2), align: 0.5)
})

let scenes: [Scene] = [intro, problem, authorScene, reviewer, montage, fib, outro]
let total = scenes.last!.end

// MARK: - render

let bytesPerRow = Int(W) * 4
var buffer = [UInt8](repeating: 0, count: bytesPerRow * Int(H))
func drawFrame(_ t: CGFloat) {
    guard let i = scenes.firstIndex(where: { t >= $0.start && t < $0.end }) ?? Optional(scenes.count - 1) else { return }
    let scene = scenes[i]
    scene.draw(t)
    // A short crossfade from the previous scene keeps cuts soft.
    let xf: CGFloat = 0.35
    if i > 0, t - scene.start < xf {
        ctx.saveGState(); ctx.setAlpha(1 - easeInOut((t - scene.start) / xf))
        ctx.beginTransparencyLayer(auxiliaryInfo: nil); scenes[i - 1].draw(scene.start - 0.001); ctx.endTransparencyLayer()
        ctx.restoreGState()
    }
}
func makeContext(_ raw: UnsafeMutableRawBufferPointer) -> CGContext {
    CGContext(data: raw.baseAddress, width: Int(W), height: Int(H), bitsPerComponent: 8, bytesPerRow: bytesPerRow,
              space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
}
FileHandle.standardError.write(Data("assets: \(diffRows.count) diff rows, \(handover.count) handover lines, \(rep.checks.count) checks, \(tagsCard.pins.count) pins, \(total)s\n".utf8))

if let only = ProcessInfo.processInfo.environment["FILM_ONLY"] {
    // Stills for checking: FILM_ONLY=1.5,20 writes still-1.5.png and still-20.png into FILM_STILLS (default .).
    let dir = URL(fileURLWithPath: ProcessInfo.processInfo.environment["FILM_STILLS"] ?? ".")
    for s in only.split(separator: ",") {
        let t = CGFloat(Double(s) ?? 0)
        buffer.withUnsafeMutableBytes { raw in
            ctx = makeContext(raw); drawFrame(t)
            let img = ctx.makeImage()!
            let url = dir.appendingPathComponent("still-\(s).png")
            let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
            CGImageDestinationAddImage(dest, img, nil); CGImageDestinationFinalize(dest)
        }
    }
    exit(0)
}
let out = FileHandle.standardOutput
let frameCount = Int(total * FPS)
for f in 0..<frameCount {
    let t = CGFloat(Double(f) / FPS)
    buffer.withUnsafeMutableBytes { raw in ctx = makeContext(raw); drawFrame(t) }
    buffer.withUnsafeBytes { out.write(Data($0)) }
    if f % 150 == 0 { FileHandle.standardError.write(Data("frame \(f)/\(frameCount)\n".utf8)) }
}
