package android.content.res;
public final class AssetManager {
 public java.io.InputStream open(String name) throws java.io.IOException {
  if(name.startsWith("/")||name.contains("..")||name.contains("\\"))throw new java.io.FileNotFoundException("invalid_asset");
  var value=getClass().getClassLoader().getResourceAsStream("assets/"+name);
  if(value==null)throw new java.io.FileNotFoundException("missing_asset");return value;
 }
}
