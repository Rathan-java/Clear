import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/storage.dart';
import '../data/firebase_service.dart';
import '../data/models.dart';
import 'answers_controller.dart';
import 'auth_controller.dart';
import 'settings_controller.dart';

/// Overridden in main() once SharedPreferences has loaded.
final storageProvider = Provider<Storage>((ref) => throw UnimplementedError('storageProvider must be overridden'));

final firebaseProvider = Provider<FirebaseService>((ref) {
  final service = FirebaseService(ref.watch(storageProvider));
  ref.onDispose(service.dispose);
  return service;
});

final authControllerProvider = StateNotifierProvider<AuthController, AuthState>((ref) {
  return AuthController(
    firebase: ref.watch(firebaseProvider),
    storage: ref.watch(storageProvider),
  );
});

final answersControllerProvider = StateNotifierProvider<AnswersController, AnswersState>((ref) {
  return AnswersController(
    firebase: ref.watch(firebaseProvider),
    storage: ref.watch(storageProvider),
  );
});

final settingsControllerProvider = StateNotifierProvider<SettingsController, SettingsState>((ref) {
  return SettingsController(ref.watch(storageProvider));
});

/// Firebase's own auth stream - the source of truth for "am I signed in".
final authStateProvider = StreamProvider<User?>((ref) => ref.watch(firebaseProvider).authState);

/// Who else is signed into this account right now, from users/{uid}/devices.
final presenceProvider = StreamProvider<Presence>((ref) {
  final auth = ref.watch(authControllerProvider);
  if (!auth.isSignedIn) return Stream.value(const Presence());
  return ref.watch(firebaseProvider).presence();
});

/// Live transcript lines, oldest first, when the desktop publishes them.
final transcriptProvider = StreamProvider<List<TranscriptLine>>((ref) {
  final auth = ref.watch(authControllerProvider);
  if (!auth.isSignedIn) return Stream.value(const []);
  return ref.watch(firebaseProvider).transcripts();
});

final searchQueryProvider = StateProvider<String>((ref) => '');

final themeModeProvider = Provider<ThemeMode>((ref) {
  switch (ref.watch(settingsControllerProvider).themeMode) {
    case 'light':
      return ThemeMode.light;
    case 'system':
      return ThemeMode.system;
    default:
      return ThemeMode.dark;
  }
});
