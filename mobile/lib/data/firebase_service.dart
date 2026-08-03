import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../core/storage.dart';
import 'models.dart';

/// Everything this app needs from Firebase.
///
/// There is no server and no socket: the desktop writes to Firestore and these
/// snapshot streams deliver the change to the phone, usually well inside a
/// second, over whatever connection the phone happens to have.
class FirebaseService {
  FirebaseService(this._storage);

  final Storage _storage;
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  Timer? _heartbeat;

  User? get currentUser => _auth.currentUser;
  String? get uid => _auth.currentUser?.uid;
  Stream<User?> get authState => _auth.authStateChanges();

  DocumentReference<Map<String, dynamic>> get _userDoc => _db.collection('users').doc(uid);

  // ---- auth ---------------------------------------------------------------

  /// Signs in, creating the account if the email is new - same behaviour as the
  /// desktop, so whichever device you set up first just works.
  Future<UserCredential> signIn({required String email, required String password}) async {
    try {
      return await _auth.signInWithEmailAndPassword(email: email, password: password);
    } on FirebaseAuthException catch (error) {
      const unknownAccount = ['user-not-found', 'invalid-credential', 'INVALID_LOGIN_CREDENTIALS'];
      if (!unknownAccount.contains(error.code)) rethrow;

      try {
        return await _auth.createUserWithEmailAndPassword(email: email, password: password);
      } on FirebaseAuthException catch (signUpError) {
        // The address exists, so the original failure was a wrong password.
        if (signUpError.code == 'email-already-in-use') {
          throw FirebaseAuthException(code: 'wrong-password', message: 'Wrong email or password.');
        }
        rethrow;
      }
    }
  }

  Future<void> signOut() async {
    stopHeartbeat();
    await _removeDevice();
    await _auth.signOut();
  }

  /// Turns Firebase's error codes into something worth reading.
  static String describeAuthError(Object error) {
    if (error is! FirebaseAuthException) return 'Something went wrong. Try again.';
    switch (error.code) {
      case 'invalid-email':
        return 'That email address is not valid.';
      case 'user-disabled':
        return 'That account has been disabled.';
      case 'user-not-found':
        return 'No account with that email.';
      case 'wrong-password':
      case 'invalid-credential':
        return 'Wrong email or password.';
      case 'email-already-in-use':
        return 'That email already has an account - sign in instead.';
      case 'weak-password':
        return 'Password must be at least 6 characters.';
      case 'too-many-requests':
        return 'Too many attempts. Wait a few minutes and try again.';
      case 'network-request-failed':
        return 'No internet connection.';
      case 'operation-not-allowed':
        return 'Email sign-in is not enabled in the Firebase project.';
      default:
        return error.message ?? 'Sign-in failed (${error.code}).';
    }
  }

  // ---- live data ----------------------------------------------------------

  /// Newest answers first. This is the stream the dashboard and history render.
  Stream<List<Answer>> answers({int limit = 50}) {
    if (uid == null) return Stream.value(const []);
    return _userDoc
        .collection('answers')
        .orderBy('createdAt', descending: true)
        .limit(limit)
        .snapshots()
        .map((snapshot) => snapshot.docs.map(Answer.fromDoc).toList());
  }

  /// Raw document changes, so notifications fire only for genuinely new answers
  /// rather than for the whole backlog on first connect.
  Stream<QuerySnapshot<Map<String, dynamic>>> answerChanges({int limit = 50}) {
    if (uid == null) return const Stream.empty();
    return _userDoc.collection('answers').orderBy('createdAt', descending: true).limit(limit).snapshots();
  }

  Stream<List<TranscriptLine>> transcripts({int limit = 40}) {
    if (uid == null) return Stream.value(const []);
    return _userDoc
        .collection('transcripts')
        .orderBy('createdAt', descending: true)
        .limit(limit)
        .snapshots()
        .map((snapshot) => snapshot.docs.map(TranscriptLine.fromDoc).toList().reversed.toList());
  }

  Stream<Presence> presence() {
    if (uid == null) return Stream.value(const Presence());
    return _userDoc
        .collection('devices')
        .snapshots()
        .map((snapshot) => Presence.fromDevices(snapshot.docs.map(DeviceInfo.fromDoc).toList()));
  }

  /// One page of older answers, for infinite scroll in History.
  Future<List<Answer>> olderAnswers({required DateTime before, int limit = 30}) async {
    if (uid == null) return const [];
    final snapshot = await _userDoc
        .collection('answers')
        .orderBy('createdAt', descending: true)
        .startAfter([Timestamp.fromDate(before)])
        .limit(limit)
        .get();
    return snapshot.docs.map(Answer.fromDoc).toList();
  }

  // ---- presence -----------------------------------------------------------

  /// Announces this phone so the desktop can show it as connected.
  Future<void> announceDevice() async {
    if (uid == null) return;
    try {
      await _userDoc.collection('devices').doc(_storage.deviceId).set({
        'platform': 'mobile',
        'name': 'Android phone',
        'lastSeenAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    } catch (_) {
      // Presence is cosmetic; never let it surface as an error.
    }
  }

  void startHeartbeat() {
    stopHeartbeat();
    announceDevice();
    _heartbeat = Timer.periodic(const Duration(seconds: 45), (_) => announceDevice());
  }

  void stopHeartbeat() {
    _heartbeat?.cancel();
    _heartbeat = null;
  }

  Future<void> _removeDevice() async {
    if (uid == null) return;
    try {
      await _userDoc.collection('devices').doc(_storage.deviceId).delete();
    } catch (_) {
      // Nothing to do - it ages out of presence on its own.
    }
  }

  void dispose() => stopHeartbeat();
}
