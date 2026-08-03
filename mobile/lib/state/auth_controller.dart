import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/storage.dart';
import '../data/firebase_service.dart';

enum AuthStatus { unknown, signedOut, signedIn }

class AuthState {
  const AuthState({
    this.status = AuthStatus.unknown,
    this.email,
    this.uid,
    this.busy = false,
    this.error,
  });

  final AuthStatus status;
  final String? email;
  final String? uid;
  final bool busy;
  final String? error;

  bool get isSignedIn => status == AuthStatus.signedIn;

  AuthState copyWith({
    AuthStatus? status,
    String? email,
    String? uid,
    bool? busy,
    String? error,
    bool clearError = false,
  }) =>
      AuthState(
        status: status ?? this.status,
        email: email ?? this.email,
        uid: uid ?? this.uid,
        busy: busy ?? this.busy,
        error: clearError ? null : (error ?? this.error),
      );
}

/// Wraps Firebase Auth. There is no pairing step - signing into the same
/// account as the desktop is what links them.
class AuthController extends StateNotifier<AuthState> {
  AuthController({required FirebaseService firebase, required Storage storage})
      : _firebase = firebase,
        _storage = storage,
        super(const AuthState()) {
    _subscription = _firebase.authState.listen(_onAuthChanged);
  }

  final FirebaseService _firebase;
  final Storage _storage;
  late final StreamSubscription<User?> _subscription;

  /// Firebase restores the session from disk on launch, so this fires once at
  /// startup with the already-signed-in user (or null).
  void _onAuthChanged(User? user) {
    if (user == null) {
      _firebase.stopHeartbeat();
      state = state.copyWith(status: AuthStatus.signedOut, uid: null);
      return;
    }

    _storage.setLastEmail(user.email);
    _firebase.startHeartbeat();
    state = state.copyWith(
      status: AuthStatus.signedIn,
      email: user.email,
      uid: user.uid,
      clearError: true,
    );
  }

  Future<bool> signIn({required String email, required String password}) async {
    state = state.copyWith(busy: true, clearError: true);
    try {
      await _firebase.signIn(email: email.trim(), password: password);
      state = state.copyWith(busy: false, clearError: true);
      return true;
    } catch (error) {
      state = state.copyWith(busy: false, error: FirebaseService.describeAuthError(error));
      return false;
    }
  }

  Future<void> signOut() async {
    await _firebase.signOut();
    state = const AuthState(status: AuthStatus.signedOut);
  }

  void clearError() => state = state.copyWith(clearError: true);

  @override
  void dispose() {
    _subscription.cancel();
    super.dispose();
  }
}
