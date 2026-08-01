import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app.dart';
import '../../state/providers.dart';

class PairingPage extends ConsumerStatefulWidget {
  const PairingPage({super.key});

  static const route = '/pairing';

  @override
  ConsumerState<PairingPage> createState() => _PairingPageState();
}

class _PairingPageState extends ConsumerState<PairingPage> {
  final _controller = TextEditingController();

  @override
  void initState() {
    super.initState();
    // If this account is already linked to a desktop, skip straight through.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await ref.read(authControllerProvider.notifier).refreshPairing();
      if (mounted && ref.read(authControllerProvider).isPaired) {
        Navigator.of(context).pushReplacementNamed(HomeShell.route);
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final code = _controller.text.trim().toUpperCase();
    if (code.length < 4) return;
    FocusScope.of(context).unfocus();

    final error = await ref.read(authControllerProvider.notifier).pair(code);
    if (!mounted) return;

    if (error == null) {
      HapticFeedback.mediumImpact();
      Navigator.of(context).pushReplacementNamed(HomeShell.route);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Pair with desktop'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pushReplacementNamed(HomeShell.route),
            child: const Text('Skip'),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(Icons.desktop_windows_outlined, color: scheme.primary),
                          const SizedBox(width: 10),
                          Text(
                            'On your Windows PC',
                            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      const _Step(number: 1, text: 'Open Clear and sign in with the same account.'),
                      const _Step(number: 2, text: 'Go to the "Pair phone" tab.'),
                      const _Step(number: 3, text: 'Tap "Generate pairing code".'),
                      const _Step(number: 4, text: 'Type that code below within five minutes.'),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 24),

              Text(
                'Pairing code',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _controller,
                textCapitalization: TextCapitalization.characters,
                textAlign: TextAlign.center,
                autofocus: true,
                maxLength: 9,
                style: const TextStyle(fontSize: 30, letterSpacing: 7, fontWeight: FontWeight.w700),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9\-]')),
                  _PairingCodeFormatter(),
                ],
                decoration: const InputDecoration(hintText: 'XXXX-XXXX', counterText: ''),
                onSubmitted: (_) => _submit(),
              ),

              if (auth.error != null) ...[
                const SizedBox(height: 12),
                Text(auth.error!, style: TextStyle(color: scheme.error), textAlign: TextAlign.center),
              ],

              const SizedBox(height: 22),
              FilledButton.icon(
                onPressed: auth.busy ? null : _submit,
                icon: auth.busy
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
                      )
                    : const Icon(Icons.link),
                label: Text(auth.busy ? 'Pairing…' : 'Pair device'),
              ),
              const SizedBox(height: 14),
              Text(
                'Codes are single use and expire after five minutes.',
                textAlign: TextAlign.center,
                style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.number, required this.text});

  final int number;
  final String text;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 22,
            height: 22,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: scheme.primary.withValues(alpha: 0.15),
              shape: BoxShape.circle,
            ),
            child: Text(
              '$number',
              style: TextStyle(color: scheme.primary, fontSize: 12, fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: TextStyle(color: scheme.onSurfaceVariant))),
        ],
      ),
    );
  }
}

/// Uppercases and re-inserts the dash so the field always reads XXXX-XXXX.
class _PairingCodeFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final raw = newValue.text.toUpperCase().replaceAll('-', '');
    final buffer = StringBuffer();
    for (var i = 0; i < raw.length && i < 8; i++) {
      if (i == 4) buffer.write('-');
      buffer.write(raw[i]);
    }
    final text = buffer.toString();
    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
  }
}
