import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app.dart';
import '../../core/config.dart';
import '../../state/providers.dart';
import 'login_page.dart';
import 'pairing_page.dart';

class SplashPage extends ConsumerStatefulWidget {
  const SplashPage({super.key});

  static const route = '/';

  @override
  ConsumerState<SplashPage> createState() => _SplashPageState();
}

class _SplashPageState extends ConsumerState<SplashPage> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat(reverse: true);

  @override
  void initState() {
    super.initState();
    _boot();
  }

  Future<void> _boot() async {
    // Restore the session while the logo breathes, but never flash past too fast.
    final started = DateTime.now();
    await ref.read(authControllerProvider.notifier).restore();
    final elapsed = DateTime.now().difference(started);
    if (elapsed < const Duration(milliseconds: 900)) {
      await Future<void>.delayed(const Duration(milliseconds: 900) - elapsed);
    }

    if (!mounted) return;

    final auth = ref.read(authControllerProvider);
    if (!auth.isSignedIn) {
      Navigator.of(context).pushReplacementNamed(LoginPage.route);
    } else if (!auth.isPaired) {
      Navigator.of(context).pushReplacementNamed(PairingPage.route);
    } else {
      Navigator.of(context).pushReplacementNamed(HomeShell.route);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ScaleTransition(
              scale: Tween<double>(begin: 0.92, end: 1.06).animate(
                CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
              ),
              child: Container(
                width: 96,
                height: 96,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(28),
                  gradient: const LinearGradient(
                    colors: [Color(0xFF3B82F6), Color(0xFF7C3AED)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF4F8CFF).withValues(alpha: 0.35),
                      blurRadius: 32,
                      spreadRadius: 2,
                    ),
                  ],
                ),
                child: const Icon(Icons.graphic_eq_rounded, color: Colors.white, size: 44),
              ),
            ),
            const SizedBox(height: 26),
            Text(
              AppConfig.appName,
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            Text(
              AppConfig.tagline,
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 34),
            SizedBox(
              width: 26,
              height: 26,
              child: CircularProgressIndicator(strokeWidth: 2.4, color: scheme.primary),
            ),
          ],
        ),
      ),
    );
  }
}
