package android.content.pm;
public final class PackageManager {
 private final String pkg;
 public PackageManager(String pkg) { this.pkg=pkg; }
 public android.content.res.Resources getResourcesForApplication(String name) {
  if(!pkg.equals(name))throw new UnsupportedOperationException("other_package_unsupported");return new android.content.res.Resources();
 }
}
