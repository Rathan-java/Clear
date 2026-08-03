import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/providers.dart';
import '../widgets/answer_card.dart';
import '../widgets/status_banner.dart';

/// The page you leave open during a meeting: newest answer front and centre,
/// live transcript underneath.
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
    final transcript = ref.watch(transcriptProvider).valueOrNull ?? const [];
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
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.read(answersControllerProvider.notifier).refresh(),
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            const SliverToBoxAdapter(child: StatusBanner()),

            if (answers.error != null)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                  child: Text(
                    answers.error!,
                    style: TextStyle(color: scheme.error, fontSize: 12.5),
                  ),
                ),
              ),

            if (answers.loading && answers.answers.isEmpty)
              const SliverFillRemaining(
                hasScrollBody: false,
                child: Center(child: CircularProgressIndicator()),
              ),

            if (!answers.loading && answers.answers.isEmpty)
              const SliverFillRemaining(
                hasScrollBody: false,
                child: EmptyState(
                  icon: Icons.auto_awesome_outlined,
                  title: 'Waiting for the first question',
                  body: 'Start listening on your desktop. When someone asks something in the meeting, '
                      'the answer appears here within a second - wherever you are.',
                ),
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
                                    line.text,
                                    style: TextStyle(
                                      fontSize: 13.5,
                                      color: line.isQuestion ? scheme.primary : scheme.onSurfaceVariant,
                                      fontWeight: line.isQuestion ? FontWeight.w600 : FontWeight.normal,
                                      height: 1.4,
                                    ),
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
