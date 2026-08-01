import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/notifications.dart';
import 'core/storage.dart';
import 'state/providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  final storage = await Storage.create();
  await NotificationService.instance.init();

  runApp(
    ProviderScope(
      overrides: [storageProvider.overrideWithValue(storage)],
      child: const ClearApp(),
    ),
  );
}
