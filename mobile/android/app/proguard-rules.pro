# Flutter engine + plugins keep their own rules; these cover the ones that need help.
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# Flutter's PlayStoreDeferredComponentManager references Play Core, which we do
# not ship because this app has no deferred components. Without these, R8 fails
# the release build on "Missing class com.google.android.play.core.tasks.*".
-dontwarn com.google.android.play.core.**
-dontwarn io.flutter.embedding.engine.deferredcomponents.**

# Firebase / Google Play Services
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Firestore models are read reflectively
-keepclassmembers class * {
  @com.google.firebase.firestore.PropertyName <fields>;
}

# flutter_local_notifications (uses reflection for scheduled notifications)
-keep class com.dexterous.** { *; }
-dontwarn com.dexterous.**

# Keep annotations used by the plugins above
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod
