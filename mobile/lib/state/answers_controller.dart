import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/notifications.dart';
import '../core/storage.dart';
import '../data/api_client.dart';
import '../data/models.dart';
import '../data/socket_service.dart';

class AnswersState {
  const AnswersState({
    this.answers = const [],
    this.loading = false,
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

/// Owns the answer feed: live socket pushes merged with paginated history.
class AnswersController extends StateNotifier<AnswersState> {
  AnswersController({
    required ApiClient api,
    required SocketService socket,
    required Storage storage,
  })  : _api = api,
        _storage = storage,
        super(const AnswersState()) {
    _subscription = socket.answers.listen(_onAnswer);
  }

  final ApiClient _api;
  final Storage _storage;
  late final StreamSubscription<Answer> _subscription;

  void _onAnswer(Answer answer) {
    // The backend replays recent answers on connect; do not duplicate them.
    if (state.answers.any((existing) => existing.id == answer.id)) return;

    state = state.copyWith(
      answers: [answer, ...state.answers],
      unread: answer.replay ? state.unread : state.unread + 1,
      clearError: true,
    );

    if (!answer.replay && _storage.notificationsEnabled) {
      NotificationService.instance.showAnswer(answer);
    }
  }

  Future<void> load({bool refresh = false}) async {
    if (state.loading) return;
    state = state.copyWith(loading: true, clearError: true);
    try {
      final answers = await _api.history();
      state = state.copyWith(
        answers: answers,
        loading: false,
        hasMore: answers.isNotEmpty,
        unread: refresh ? 0 : state.unread,
      );
    } on ApiException catch (error) {
      state = state.copyWith(loading: false, error: error.message);
    }
  }

  Future<void> loadMore() async {
    if (state.loadingMore || !state.hasMore || state.answers.isEmpty) return;
    state = state.copyWith(loadingMore: true);
    try {
      final older = await _api.history(before: state.answers.last.createdAt.millisecondsSinceEpoch);
      final existing = state.answers.map((a) => a.id).toSet();
      final fresh = older.where((a) => !existing.contains(a.id)).toList();
      state = state.copyWith(
        answers: [...state.answers, ...fresh],
        loadingMore: false,
        hasMore: fresh.isNotEmpty,
      );
    } on ApiException catch (error) {
      state = state.copyWith(loadingMore: false, error: error.message);
    }
  }

  /// Server-side search, with a local fallback so it still works offline.
  Future<List<Answer>> search(String query) async {
    if (query.trim().isEmpty) return state.answers;
    try {
      return await _api.history(search: query, limit: 100);
    } on ApiException {
      return state.answers.where((answer) => answer.matches(query)).toList();
    }
  }

  void markRead() {
    if (state.unread != 0) state = state.copyWith(unread: 0);
  }

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }
}
