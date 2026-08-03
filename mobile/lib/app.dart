import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/config.dart';
import 'core/theme.dart';
import 'state/providers.dart';
import 'ui/pages/dashboard_page.dart';
import 'ui/pages/history_page.dart';
import 'ui/pages/login_page.dart';
import 'ui/pages/settings_page.dart';
import 'ui/pages/splash_page.dart';

class ClearApp extends ConsumerWidget {
  const ClearApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ref.watch(themeModeProvider),
      initialRoute: SplashPage.route,
      routes: {
        SplashPage.route: (_) => const SplashPage(),
        LoginPage.route: (_) => const LoginPage(),
        HomeShell.route: (_) => const HomeShell(),
        HistoryPage.route: (_) => const HistoryPage(),
        SettingsPage.route: (_) => const SettingsPage(),
      },
    );
  }
}

/// Bottom-nav shell holding the three main pages.
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  static const route = '/home';

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final unread = ref.watch(answersControllerProvider).unread;

    // Signing out from anywhere drops straight back to the login screen.
    ref.listen(authControllerProvider, (previous, next) {
      if (previous?.isSignedIn == true && !next.isSignedIn) {
        Navigator.of(context).pushNamedAndRemoveUntil(LoginPage.route, (route) => false);
      }
    });

    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: const [DashboardPage(), HistoryPage(embedded: true), SettingsPage(embedded: true)],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (index) {
          setState(() => _index = index);
          if (index == 0) ref.read(answersControllerProvider.notifier).markRead();
        },
        destinations: [
          NavigationDestination(
            icon: Badge(
              isLabelVisible: unread > 0,
              label: Text('$unread'),
              child: const Icon(Icons.bolt_outlined),
            ),
            selectedIcon: const Icon(Icons.bolt),
            label: 'Live',
          ),
          const NavigationDestination(
            icon: Icon(Icons.history_outlined),
            selectedIcon: Icon(Icons.history),
            label: 'History',
          ),
          const NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}
