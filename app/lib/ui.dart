import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:image/image.dart' as img;
import 'config.dart';
import 'core.dart';

const cInk = Color(0xFF1F2A1A), cOlive = Color(0xFF4D6B3C), cOliveDark = Color(0xFF2F3D27), cGold = Color(0xFFC9A24A), cBg = Color(0xFFF4EFE4), cCard = Color(0xFFFFFDF8);
const cOk = Color(0xFF2E7D4F), cWarn = Color(0xFFB7791F), cBad = Color(0xFFB3412F), cMuted = Color(0xFF6B6A5E);

ThemeData appTheme() {
  final base = ThemeData(useMaterial3: true, colorScheme: ColorScheme.fromSeed(seedColor: cOlive, primary: cOlive, secondary: cGold, surface: cCard), fontFamily: 'Cairo');
  return base.copyWith(
    scaffoldBackgroundColor: cBg,
    appBarTheme: const AppBarTheme(backgroundColor: cOliveDark, foregroundColor: Colors.white, elevation: 0, scrolledUnderElevation: 0, centerTitle: false),
    cardTheme: CardThemeData(color: cCard, elevation: 0, margin: EdgeInsets.zero, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: Color(0x1A1F2A1A)))),
    inputDecorationTheme: InputDecorationTheme(filled: true, fillColor: Colors.white, border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)), contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14)),
    filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52), textStyle: const TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w700, fontSize: 16), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)))),
    outlinedButtonTheme: OutlinedButtonThemeData(style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), textStyle: const TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.w600), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)))),
    navigationBarTheme: NavigationBarThemeData(backgroundColor: cCard, indicatorColor: cOlive.withValues(alpha: .15), labelTextStyle: WidgetStateProperty.all(const TextStyle(fontFamily: 'Cairo', fontSize: 12, fontWeight: FontWeight.w600))),
  );
}

Color stColor(String s) => switch (s) { 'ok' => cOk, 'late' || 'open' => cWarn, 'absent' || 'bad' => cBad, 'leave' => const Color(0xFF3B6EA5), _ => cMuted };
Widget chip(String s, [String? extra]) {
  final c = stColor(s);
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
    decoration: BoxDecoration(color: c.withValues(alpha: .12), borderRadius: BorderRadius.circular(99)),
    child: Text('${stLabel[s] ?? s}${extra != null && extra.isNotEmpty ? ' · $extra' : ''}', style: TextStyle(color: c, fontWeight: FontWeight.w700, fontSize: 12)),
  );
}
Widget tagChip(String text, Color c) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
    decoration: BoxDecoration(color: c.withValues(alpha: .12), borderRadius: BorderRadius.circular(99)),
    child: Text(text, style: TextStyle(color: c, fontWeight: FontWeight.w700, fontSize: 12)));

class Section extends StatelessWidget {
  final String? title;
  final Widget? trailing;
  final List<Widget> children;
  const Section({super.key, this.title, this.trailing, required this.children});
  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (title != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(children: [Expanded(child: Text(title!, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: cInk))), if (trailing != null) trailing!]),
              ),
            ...children,
          ]),
        ),
      );
}
Widget gap([double h = 12]) => SizedBox(height: h);
Widget note(String t, {Color color = cMuted, double size = 13}) => Text(t, style: TextStyle(color: color, fontSize: size, height: 1.5));
Widget banner(String text, {Color color = cWarn, String? action, VoidCallback? onTap, IconData icon = Icons.info_outline}) => Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: color.withValues(alpha: .1), borderRadius: BorderRadius.circular(12), border: Border.all(color: color.withValues(alpha: .3))),
      child: Row(children: [
        Icon(icon, color: color),
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: TextStyle(color: color, fontWeight: FontWeight.w600))),
        if (action != null) TextButton(onPressed: onTap, child: Text(action)),
      ]),
    );
void toast(BuildContext ctx, String msg, {bool bad = false}) {
  ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text(msg, style: const TextStyle(fontFamily: 'Cairo')), backgroundColor: bad ? cBad : cOliveDark, behavior: SnackBarBehavior.floating));
}
Widget netPhoto(String id, {double? h, BoxFit fit = BoxFit.cover}) => ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: Image.network('$photosBase$id', height: h, fit: fit, errorBuilder: (_, __, ___) => Container(height: h ?? 80, color: const Color(0x11000000), alignment: Alignment.center, child: note('تعذّر العرض'))),
    );
void openPhoto(BuildContext ctx, String id) => Navigator.of(ctx).push(MaterialPageRoute(
    builder: (_) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(backgroundColor: Colors.black),
        body: InteractiveViewer(child: Center(child: Image.network('$photosBase$id'))))));

/* ---------- photo processing: shrink, then burn in name, mosque, prayer and time ---------- */
Future<Uint8List> shrinkJpeg(Uint8List src, {int max = 1600, int quality = 82}) async {
  final codec = await ui.instantiateImageCodec(src);
  final f = await codec.getNextFrame();
  final w0 = f.image.width, h0 = f.image.height;
  final s = (max / (w0 > h0 ? w0 : h0)).clamp(0.0, 1.0);
  final w = (w0 * s).round(), h = (h0 * s).round();
  final rec = ui.PictureRecorder();
  final cv = Canvas(rec);
  cv.drawImageRect(f.image, Rect.fromLTWH(0, 0, w0.toDouble(), h0.toDouble()), Rect.fromLTWH(0, 0, w.toDouble(), h.toDouble()), Paint()..filterQuality = FilterQuality.medium);
  final out = await rec.endRecording().toImage(w, h);
  return _jpeg(out, quality);
}
Future<Uint8List> stampPhoto(Uint8List src, List<String> lines) async {
  final codec = await ui.instantiateImageCodec(src);
  final f = await codec.getNextFrame();
  final w0 = f.image.width, h0 = f.image.height;
  final s = (1024 / (w0 > h0 ? w0 : h0)).clamp(0.0, 1.0);
  final W = (w0 * s).round(), H = (h0 * s).round();
  final fs = (W / 38).clamp(15, 60).toDouble(), pad = fs * .6, lineH = fs + pad * .6, bar = lines.length * lineH + pad;
  final rec = ui.PictureRecorder();
  final cv = Canvas(rec);
  cv.drawImageRect(f.image, Rect.fromLTWH(0, 0, w0.toDouble(), h0.toDouble()), Rect.fromLTWH(0, 0, W.toDouble(), H.toDouble()), Paint()..filterQuality = FilterQuality.medium);
  cv.drawRect(Rect.fromLTWH(0, H.toDouble(), W.toDouble(), bar), Paint()..color = cInk);
  for (var i = 0; i < lines.length; i++) {
    final tp = TextPainter(
        text: TextSpan(text: lines[i], style: TextStyle(color: Colors.white, fontSize: fs, fontFamily: 'Cairo', fontWeight: FontWeight.w600)),
        textDirection: TextDirection.rtl,
        textAlign: TextAlign.right,
        maxLines: 1,
        ellipsis: '…')
      ..layout(maxWidth: W - pad * 2);
    tp.paint(cv, Offset(W - pad - tp.width, H + pad * .8 + i * lineH));
  }
  final out = await rec.endRecording().toImage(W, (H + bar).round());
  return _jpeg(out, 72);
}
Future<Uint8List> _jpeg(ui.Image im, int q) async {
  final bd = await im.toByteData(format: ui.ImageByteFormat.rawRgba);
  final m = img.Image.fromBytes(width: im.width, height: im.height, bytes: bd!.buffer, numChannels: 4);
  return Uint8List.fromList(img.encodeJpg(m, quality: q));
}
String defMonth() {
  final d = DateTime.now();
  final x = d.day <= 10 ? DateTime(d.year, d.month, 0) : d;
  return dkey(x).substring(0, 7);
}
