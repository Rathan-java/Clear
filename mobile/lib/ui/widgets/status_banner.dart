import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/socket_service.dart';
import '../../state/providers.dart';

/// Connection strip: is the phone online, is the desktop listening, how fast.
class StatusBanner extends ConsumerWidget {
  const StatusBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(connectionStatusProvider);
    final scheme = Theme.of(context).colorScheme;

    final (Color color, IconData icon, String label) = switch (status.state) {
      SocketState.connected => status.presence.desktopOnline
          ? (const Color(0xFF34D399), Icons.podcasts_rounded, 'Desktop connected')
          : (const Color(0xFFFBBF24), Icons.desktop_access_disabled_outlined, 'Waiting for your desktop'),
      SocketState.connecting => (scheme.primary, Icons.sync, 'Connecting…'),
      SocketState.reconnecting => (const Color(0xFFFBBF24), Icons.sync_problem, 'Reconnecting…'),
      SocketState.error => (scheme.error, Icons.cloud_off, status.error ?? 'Offline'),
      SocketState.idle => (scheme.onSurfaceVariant, Icons.cloud_queue, 'Not connected'),
    };

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.11),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 13.5),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (status.latencyMs != null) ...[
            Text(
              '${status.latencyMs} ms',
              style: TextStyle(color: color.withValues(alpha: 0.85), fontSize: 12.5),
            ),
            const SizedBox(width: 8),
          ],
          if (!status.connected)
            SizedBox(
              height: 28,
              child: TextButton(
                onPressed: () => ref.read(authControllerProvider.notifier).reconnect(),
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Text('Retry', style: TextStyle(fontSize: 12.5)),
              ),
            ),
        ],
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.body, this.action});

  final IconData icon;
  final String title;
  final String? body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: scheme.primary.withValues(alpha: 0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, size: 34, color: scheme.primary),
            ),
            const SizedBox(height: 18),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
            ),
            if (body != null) ...[
              const SizedBox(height: 8),
              Text(
                body!,
                textAlign: TextAlign.center,
                style: TextStyle(color: scheme.onSurfaceVariant, height: 1.45),
              ),
            ],
            if (action != null) ...[const SizedBox(height: 20), action!],
          ],
        ),
      ),
    );
  }
}
