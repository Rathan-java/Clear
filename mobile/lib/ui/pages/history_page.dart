import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/providers.dart';
import '../widgets/answer_card.dart';
import '../widgets/status_banner.dart';

class HistoryPage extends ConsumerStatefulWidget {
  const HistoryPage({super.key, this.embedded = false});

  static const route = '/history';

  /// True when rendered inside the bottom-nav shell (no back button).
  final bool embedded;

  @override
  ConsumerState<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends ConsumerState<HistoryPage> {
  final _scrollController = ScrollController();
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(() {
      final position = _scrollController.position;
      if (position.pixels > position.maxScrollExtent - 400) {
        ref.read(answersControllerProvider.notifier).loadMore();
      }
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(answersControllerProvider);
    final query = ref.watch(searchQueryProvider);
    final answers = ref.read(answersControllerProvider.notifier).search(query);
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: !widget.embedded,
        title: const Text('History'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: TextField(
              controller: _searchController,
              onChanged: (value) => ref.read(searchQueryProvider.notifier).state = value,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'Search questions and answers',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: query.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchController.clear();
                          ref.read(searchQueryProvider.notifier).state = '';
                        },
                      ),
              ),
            ),
          ),

          if (!widget.embedded) const StatusBanner(),

          Expanded(
            child: RefreshIndicator(
              onRefresh: () => ref.read(answersControllerProvider.notifier).refresh(),
              child: answers.isEmpty
                  ? ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: [
                        SizedBox(height: MediaQuery.of(context).size.height * 0.18),
                        EmptyState(
                          icon: query.isEmpty ? Icons.inbox_outlined : Icons.search_off,
                          title: query.isEmpty ? 'No answers yet' : 'Nothing matched "$query"',
                          body: query.isEmpty
                              ? 'Answers generated during your meetings are kept here.'
                              : 'Search looks through the answers already loaded. Scroll down to load more.',
                        ),
                      ],
                    )
                  : ListView.separated(
                      controller: _scrollController,
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                      physics: const AlwaysScrollableScrollPhysics(),
                      itemCount: answers.length + (state.loadingMore ? 1 : 0),
                      separatorBuilder: (_, __) => const SizedBox(height: 12),
                      itemBuilder: (context, index) {
                        if (index >= answers.length) {
                          return const Padding(
                            padding: EdgeInsets.all(16),
                            child: Center(child: CircularProgressIndicator()),
                          );
                        }
                        return AnswerCard(answer: answers[index], query: query);
                      },
                    ),
            ),
          ),

          if (state.error != null)
            Container(
              width: double.infinity,
              color: scheme.errorContainer.withValues(alpha: 0.4),
              padding: const EdgeInsets.all(12),
              child: Text(state.error!, style: TextStyle(color: scheme.onErrorContainer, fontSize: 13)),
            ),
        ],
      ),
    );
  }
}
