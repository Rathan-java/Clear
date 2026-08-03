import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app.dart';
import '../../core/config.dart';
import '../../state/auth_controller.dart';
import '../../state/providers.dart';
import 'login_page.dart';

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

  bool _navigated = false;

  @override
  void initState() {
    super.initState();
    // Firebase restores the session from disk, so we just wait for its first
    // auth event rather than doing any network work ourselves.
    _minimumSplash = Future<void>.delayed(const Duration(milliseconds: 900));
  }

  late final Future<void> _minimumSplash;

  Future<void> _go(bool signedIn) async {
    if (_navigated) return;
    _navigated = true;
    await _minimumSplash;
    if (!mounted) return;
    Navigator.of(context).pushReplacementNamed(signedIn ? HomeShell.route : LoginPage.route);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    ref.listen(authControllerProvider, (previous, next) {
      if (next.status != AuthStatus.unknown) _go(next.isSignedIn);
    });

    // Covers the case where auth resolved before this widget subscribed.
    final auth = ref.watch(authControllerProvider);
    if (auth.status != AuthStatus.unknown) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _go(auth.isSignedIn));
    }

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
            Text(AppConfig.tagline, style: TextStyle(color: scheme.onSurfaceVariant)),
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
