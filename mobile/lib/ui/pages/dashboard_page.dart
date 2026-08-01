import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/providers.dart';
import '../widgets/answer_card.dart';
import '../widgets/status_banner.dart';

/// The page you leave open during a meeting: newest answer front and centre,
/// live transcript underneath, everything else out of the way.
class DashboardPage extends ConsumerStatefulWidget {
  const DashboardPage({super.key});

  @override
  ConsumerState<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends ConsumerState<DashboardPage> {
  bool _showTranscript = true;

  @override
  Widget build(BuildContext context) {
    final answers = ref.watch(answersControllerProvider);
    final auth = ref.watch(authControllerProvider);
    final transcript = ref.watch(transcriptProvider).valueOrNull ?? const <String>[];
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Live'),
        actions: [
          IconButton(
            tooltip: _showTranscript ? 'Hide transcript' : 'Show transcript',
            icon: Icon(_showTranscript ? Icons.subtitles : Icons.subtitles_off_outlined),
            onPressed: () => setState(() => _showTranscript = !_showTranscript),
          ),
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.read(answersControllerProvider.notifier).load(refresh: true),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await ref.read(answersControllerProvider.notifier).load(refresh: true);
          await ref.read(authControllerProvider.notifier).refreshPairing();
        },
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            const SliverToBoxAdapter(child: StatusBanner()),

            if (auth.pairedDesktop != null)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                  child: Row(
                    children: [
                      Icon(Icons.desktop_windows_outlined, size: 15, color: scheme.onSurfaceVariant),
                      const SizedBox(width: 6),
                      Text(
                        'Paired with ${auth.pairedDesktop}',
                        style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
              ),

            if (answers.answers.isEmpty && !answers.loading)
              SliverFillRemaining(
                hasScrollBody: false,
                child: EmptyState(
                  icon: Icons.auto_awesome_outlined,
                  title: 'Waiting for the first question',
                  body: 'Start listening on your desktop. When someone asks something, the answer lands here instantly.',
                  action: OutlinedButton.icon(
                    onPressed: () => ref.read(answersControllerProvider.notifier).load(refresh: true),
                    icon: const Icon(Icons.refresh),
                    label: const Text('Check again'),
                  ),
                ),
              ),

            if (answers.loading && answers.answers.isEmpty)
              const SliverFillRemaining(
                hasScrollBody: false,
                child: Center(child: CircularProgressIndicator()),
              ),

            if (answers.answers.isNotEmpty)
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                sliver: SliverList.separated(
                  itemCount: answers.answers.length > 12 ? 12 : answers.answers.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 12),
                  itemBuilder: (context, index) => AnswerCard(
                    answer: answers.answers[index],
                    highlight: index == 0,
                  ),
                ),
              ),

            if (_showTranscript && transcript.isNotEmpty)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  child: Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                width: 7,
                                height: 7,
                                decoration: const BoxDecoration(color: Color(0xFF34D399), shape: BoxShape.circle),
                              ),
                              const SizedBox(width: 8),
                              Text(
                                'LIVE TRANSCRIPT',
                                style: TextStyle(
                                  fontSize: 11,
                                  letterSpacing: 1.1,
                                  fontWeight: FontWeight.w700,
                                  color: scheme.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          ...transcript.reversed.take(8).map(
                                (line) => Padding(
                                  padding: const EdgeInsets.only(bottom: 8),
                                  child: Text(
                                    line,
                                    style: TextStyle(fontSize: 13.5, color: scheme.onSurfaceVariant, height: 1.4),
                                  ),
                                ),
                              ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),

            const SliverToBoxAdapter(child: SizedBox(height: 20)),
          ],
        ),
      ),
    );
  }
}
