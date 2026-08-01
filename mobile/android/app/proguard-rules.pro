# Flutter engine + plugins keep their own rules; these cover the ones that need help.
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# flutter_local_notifications (uses reflection for scheduled notifications)
-keep class com.dexterous.** { *; }
-dontwarn com.dexterous.**

# flutter_secure_storage
-keep class androidx.security.crypto.** { *; }

# Keep annotations used by the plugins above
-keepattributes *Annotation*, InnerClasses, Signature
