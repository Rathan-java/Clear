import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/notifications.dart';
import '../core/storage.dart';
import '../data/firebase_service.dart';
import '../data/models.dart';

class AnswersState {
  const AnswersState({
    this.answers = const [],
    this.loading = true,
    this.loadingMore = false,
    this.error,
    this.hasMore = true,
    this.unread = 0,
  });

  final List<Answer> answers;
  final bool loading;
  final bool loadingMore;
  final String? error;
  final bool hasMore;
  final int unread;

  Answer? get latest => answers.isEmpty ? null : answers.first;

  AnswersState copyWith({
    List<Answer>? answers,
    bool? loading,
    bool? loadingMore,
    String? error,
    bool? hasMore,
    int? unread,
    bool clearError = false,
  }) =>
      AnswersState(
        answers: answers ?? this.answers,
        loading: loading ?? this.loading,
        loadingMore: loadingMore ?? this.loadingMore,
        error: clearError ? null : (error ?? this.error),
        hasMore: hasMore ?? this.hasMore,
        unread: unread ?? this.unread,
      );
}

/// Live answer feed straight off Firestore.
///
/// The snapshot listener gives us the whole recent window and keeps it current,
/// so there is nothing to poll and nothing to reconnect. Older pages are
/// fetched on demand for infinite scroll.
class AnswersController extends StateNotifier<AnswersState> {
  AnswersController({required FirebaseService firebase, required Storage storage})
      : _firebase = firebase,
        _storage = storage,
        super(const AnswersState()) {
    _listen();
  }

  final FirebaseService _firebase;
  final Storage _storage;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _subscription;
  List<Answer> _older = const [];
  bool _primed = false;

  /// Answers already announced. Streaming means a document is created while it
  /// is still half-written and patched repeatedly, so "added" is the wrong
  /// trigger - we would notify with a fragment of a sentence, then again for
  /// every update. Notify once, when it is finished.
  final Set<String> _notified = <String>{};

  void _listen() {
    _subscription?.cancel();
    _primed = false;

    _subscription = _firebase.answerChanges().listen(
      (snapshot) {
        final live = snapshot.docs.map(Answer.fromDoc).toList();

        if (!_primed) {
          // First snapshot is the existing backlog; never announce that.
          for (final doc in snapshot.docs) {
            _notified.add(doc.id);
          }
        } else {
          // Announce an answer once, when the desktop has finished writing it.
          final finished = snapshot.docChanges
              .where((change) => change.type != DocumentChangeType.removed)
              .where((change) => !change.doc.metadata.hasPendingWrites)
              .map((change) => Answer.fromDoc(change.doc))
              .where((answer) => !answer.streaming && answer.answer.isNotEmpty)
              .where((answer) => !_notified.contains(answer.id))
              .toList();

          if (finished.isNotEmpty) {
            for (final answer in finished) {
              _notified.add(answer.id);
            }
            state = state.copyWith(unread: state.unread + finished.length);

            if (_storage.notificationsEnabled) {
              for (final answer in finished) {
                NotificationService.instance.showAnswer(answer);
              }
            }
          }
        }

        _primed = true;
        // Keep the guard set from growing without bound over a long meeting.
        if (_notified.length > 400) {
          final keep = live.map((a) => a.id).toSet();
          _notified.retainWhere(keep.contains);
        }

        // Merge in any older pages already fetched, newest first, de-duplicated.
        final seen = live.map((a) => a.id).toSet();
        final merged = [...live, ..._older.where((a) => !seen.contains(a.id))];

        state = state.copyWith(answers: merged, loading: false, clearError: true);
      },
      onError: (Object error) {
        state = state.copyWith(loading: false, error: _describe(error));
      },
    );
  }

  String _describe(Object error) {
    final message = error.toString();
    if (message.contains('permission-denied')) {
      return 'Firestore rules are blocking this account. Deploy the rules from firebase/firestore.rules.';
    }
    if (message.contains('unavailable') || message.contains('network')) {
      return 'No connection to Firebase. Answers will appear once you are back online.';
    }
    return 'Could not load answers: $message';
  }

  /// Firestore's listener is already live; this just clears any error state.
  Future<void> refresh() async {
    state = state.copyWith(clearError: true, unread: 0);
    if (state.answers.isEmpty) _listen();
  }

  Future<void> loadMore() async {
    if (state.loadingMore || !state.hasMore || state.answers.isEmpty) return;
    state = state.copyWith(loadingMore: true);

    try {
      final older = await _firebase.olderAnswers(before: state.answers.last.createdAt);
      final seen = state.answers.map((a) => a.id).toSet();
      final fresh = older.where((a) => !seen.contains(a.id)).toList();

      _older = [..._older, ...fresh];
      state = state.copyWith(
        answers: [...state.answers, ...fresh],
        loadingMore: false,
        hasMore: fresh.isNotEmpty,
      );
    } catch (error) {
      state = state.copyWith(loadingMore: false, error: _describe(error));
    }
  }

  /// Search runs locally over the loaded window - no index, no extra reads.
  List<Answer> search(String query) {
    if (query.trim().isEmpty) return state.answers;
    return state.answers.where((answer) => answer.matches(query)).toList();
  }

  void markRead() {
    if (state.unread != 0) state = state.copyWith(unread: 0);
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}
