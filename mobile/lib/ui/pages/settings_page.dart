import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config.dart';
import '../../state/providers.dart';

class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key, this.embedded = false});

  static const route = '/settings';

  final bool embedded;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(settingsControllerProvider);
    final auth = ref.watch(authControllerProvider);
    final presence = ref.watch(presenceProvider);
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: !embedded,
        title: const Text('Settings'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          _Section(
            title: 'Account',
            children: [
              ListTile(
                leading: const Icon(Icons.person_outline),
                title: Text(auth.email ?? 'Not signed in'),
                subtitle: const Text('Signing in with this account on the desktop is what links them'),
              ),
            ],
          ),

          _Section(
            title: 'Desktop',
            children: [
              presence.when(
                data: (data) => ListTile(
                  leading: Icon(
                    data.desktopOnline ? Icons.desktop_windows : Icons.desktop_access_disabled_outlined,
                    color: data.desktopOnline ? const Color(0xFF34D399) : scheme.onSurfaceVariant,
                  ),
                  title: Text(data.desktopOnline ? (data.desktopName ?? 'Desktop') : 'No desktop online'),
                  subtitle: Text(
                    data.desktopListening
                        ? 'Listening to your meeting now'
                        : data.desktopOnline
                            ? 'Running, but not listening'
                            : 'Open Clear on your PC and sign in with the same account',
                  ),
                ),
                loading: () => const ListTile(
                  leading: SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  title: Text('Checking…'),
                ),
                error: (error, _) => ListTile(
                  leading: Icon(Icons.error_outline, color: scheme.error),
                  title: const Text('Cannot reach Firebase'),
                  subtitle: Text('$error', maxLines: 2, overflow: TextOverflow.ellipsis),
                ),
              ),
            ],
          ),

          _Section(
            title: 'Appearance',
            children: [
              ListTile(
                leading: const Icon(Icons.dark_mode_outlined),
                title: const Text('Theme'),
                subtitle: Text(switch (settings.themeMode) {
                  'light' => 'Light',
                  'system' => 'Follow system',
                  _ => 'Dark',
                }),
                trailing: SegmentedButton<String>(
                  showSelectedIcon: false,
                  style: const ButtonStyle(visualDensity: VisualDensity.compact),
                  segments: const [
                    ButtonSegment(value: 'light', icon: Icon(Icons.light_mode, size: 18)),
                    ButtonSegment(value: 'system', icon: Icon(Icons.brightness_auto, size: 18)),
                    ButtonSegment(value: 'dark', icon: Icon(Icons.dark_mode, size: 18)),
                  ],
                  selected: {settings.themeMode},
                  onSelectionChanged: (selection) =>
                      ref.read(settingsControllerProvider.notifier).setThemeMode(selection.first),
                ),
              ),
            ],
          ),

          _Section(
            title: 'Notifications',
            children: [
              SwitchListTile(
                secondary: const Icon(Icons.notifications_active_outlined),
                title: const Text('Notify on new answers'),
                subtitle: const Text('Heads-up notification while the app is in the background'),
                value: settings.notificationsEnabled,
                onChanged: (value) => ref.read(settingsControllerProvider.notifier).setNotifications(value),
              ),
            ],
          ),

          _Section(
            title: 'About',
            children: [
              const ListTile(
                leading: Icon(Icons.info_outline),
                title: Text('${AppConfig.appName} for Android'),
                subtitle: Text('Version ${AppConfig.version}'),
              ),
              const ListTile(
                leading: Icon(Icons.cloud_outlined),
                title: Text('Answers arrive through Firebase'),
                subtitle: Text('This phone never connects to your PC directly'),
              ),
              ListTile(
                leading: const Icon(Icons.smartphone),
                title: const Text('This device'),
                subtitle: Text(settings.deviceId),
              ),
            ],
          ),

          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () async {
              final confirmed = await showDialog<bool>(
                context: context,
                builder: (context) => AlertDialog(
                  title: const Text('Sign out?'),
                  content: const Text('You will need to sign in again to see new answers.'),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
                    FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sign out')),
                  ],
                ),
              );
              if (confirmed != true) return;
              await ref.read(authControllerProvider.notifier).signOut();
            },
            style: OutlinedButton.styleFrom(foregroundColor: scheme.error),
            icon: const Icon(Icons.logout),
            label: const Text('Sign out'),
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 18, 4, 8),
          child: Text(
            title.toUpperCase(),
            style: TextStyle(
              fontSize: 11.5,
              letterSpacing: 1.2,
              fontWeight: FontWeight.w700,
              color: scheme.onSurfaceVariant,
            ),
          ),
        ),
        Card(child: Column(children: children)),
      ],
    );
  }
}
