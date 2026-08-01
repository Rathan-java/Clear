import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config.dart';
import '../../state/providers.dart';
import 'login_page.dart';
import 'pairing_page.dart';

class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key, this.embedded = false});

  static const route = '/settings';

  final bool embedded;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(settingsControllerProvider);
    final auth = ref.watch(authControllerProvider);
    final connection = ref.watch(connectionStatusProvider);
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
                subtitle: Text(auth.isPaired ? 'Paired with ${auth.pairedDesktop}' : 'No desktop paired yet'),
              ),
              ListTile(
                leading: const Icon(Icons.link),
                title: const Text('Pair with a desktop'),
                subtitle: const Text('Enter a new pairing code'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).pushNamed(PairingPage.route),
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
            title: 'Connection',
            children: [
              ListTile(
                leading: Icon(
                  connection.connected ? Icons.cloud_done_outlined : Icons.cloud_off_outlined,
                  color: connection.connected ? const Color(0xFF34D399) : scheme.error,
                ),
                title: Text(connection.connected ? 'Connected' : 'Not connected'),
                subtitle: Text(
                  connection.latencyMs != null
                      ? '${settings.backendUrl}  ·  ${connection.latencyMs} ms'
                      : settings.backendUrl,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: TextButton(
                  onPressed: () => ref.read(authControllerProvider.notifier).reconnect(),
                  child: const Text('Reconnect'),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.dns_outlined),
                title: const Text('Backend URL'),
                subtitle: Text(settings.backendUrl),
                trailing: const Icon(Icons.edit_outlined, size: 20),
                onTap: () => _editBackendUrl(context, ref, settings.backendUrl),
              ),
            ],
          ),

          _Section(
            title: 'About',
            children: [
              ListTile(
                leading: const Icon(Icons.info_outline),
                title: const Text('${AppConfig.appName} for Android'),
                subtitle: const Text('Version 1.0.0'),
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
                  content: const Text('You will need to sign in and pair again on this phone.'),
                  actions: [
                    TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
                    FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sign out')),
                  ],
                ),
              );
              if (confirmed != true || !context.mounted) return;

              await ref.read(authControllerProvider.notifier).signOut();
              if (!context.mounted) return;
              Navigator.of(context).pushNamedAndRemoveUntil(LoginPage.route, (route) => false);
            },
            style: OutlinedButton.styleFrom(foregroundColor: scheme.error),
            icon: const Icon(Icons.logout),
            label: const Text('Sign out'),
          ),
        ],
      ),
    );
  }

  Future<void> _editBackendUrl(BuildContext context, WidgetRef ref, String current) async {
    final controller = TextEditingController(text: current);
    final value = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Backend URL'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: const InputDecoration(hintText: 'https://your-backend.onrender.com'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: const Text('Save')),
        ],
      ),
    );

    if (value == null || value.isEmpty) return;
    await ref.read(settingsControllerProvider.notifier).setBackendUrl(value);
    await ref.read(authControllerProvider.notifier).reconnect();
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
