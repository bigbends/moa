package android.content;
/** Minimal host context. Unsupported Android services fail explicitly. */
public abstract class Context {
 public static final int MODE_PRIVATE = 0;
 public abstract SharedPreferences getSharedPreferences(String name, int mode);
 public Context getApplicationContext() { return this; }
 public String getPackageName() { return "org.moa.apkworker"; }
 public java.io.File getCacheDir() { throw new UnsupportedOperationException("cache_directory_unavailable"); }
 public java.io.File getFilesDir() { throw new UnsupportedOperationException("files_directory_unavailable"); }
 public android.content.pm.PackageManager getPackageManager() { return new android.content.pm.PackageManager(getPackageName()); }
 public android.content.res.Resources getResources() { return new android.content.res.Resources(); }
 public ClassLoader getClassLoader() { return getClass().getClassLoader(); }
 public Object getSystemService(String name) { throw new UnsupportedOperationException("android_service_unsupported"); }
}
