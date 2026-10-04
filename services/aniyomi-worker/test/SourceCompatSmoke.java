import android.net.Uri;
import android.util.LruCache;
import java.util.List;
import java.io.File;
import okhttp3.*;
import kotlin.coroutines.Continuation;

public class SourceCompatSmoke {
 public static void main(String[] args) throws Exception {
  var uri=Uri.parse("https://user@example.org:8443/한글/a%2Fb?q=a+b&q=%2B#frag");
  check(uri.getHost().equals("example.org") && uri.getPort()==8443,"host/port");
  check(uri.getPathSegments().equals(List.of("한글","a/b")),"path segments");
  check(uri.getQueryParameter("q").equals("a b"),"query plus");
  check(Uri.decode("a+b%20c").equals("a+b c"),"decode preserves plus");
  check(Uri.encode("한 글/+!").equals("%ED%95%9C%20%EA%B8%80%2F%2B!"),"encode");
  check(uri.buildUpon().clearQuery().appendQueryParameter("name","a+b 한").build().getQueryParameter("name").equals("a+b 한"),"builder round trip");
  check(Uri.fromFile(new File("/tmp/a b")).toString().equals("file:///tmp/a%20b"),"file URI");
  var removed=new java.util.ArrayList<String>();
  var cache=new LruCache<String,String>(2){protected void entryRemoved(boolean e,String k,String o,String n){removed.add(k);}};
  cache.put("a","A");cache.put("b","B");cache.get("a");cache.put("c","C");
  check(cache.get("b")==null && cache.size()==2 && removed.equals(List.of("b")),"bounded access-order eviction");
  cache.resize(1);check(cache.snapshot().keySet().equals(java.util.Set.of("c")),"resize");
  cache.evictAll();check(cache.size()==0 && cache.evictionCount()==3,"evict all");
  var weighted=new LruCache<String,String>(3){protected int sizeOf(String k,String v){return v.length();}};
  weighted.put("a","aa");weighted.put("b","bb");check(weighted.size()==2 && weighted.get("a")==null,"weighted size");
  var facade=Class.forName("eu.kanade.tachiyomi.network.RequestsKt");
  for(var url:new Class<?>[]{String.class,HttpUrl.class}) {
   facade.getMethod("get$default",OkHttpClient.class,url,Headers.class,CacheControl.class,Continuation.class,int.class,Object.class);
   facade.getMethod("post$default",OkHttpClient.class,url,Headers.class,RequestBody.class,CacheControl.class,Continuation.class,int.class,Object.class);
  }
  // Existing APK request builders must retain their original ABI as well.
  facade.getMethod("GET$default",String.class,Headers.class,CacheControl.class,int.class,Object.class);
  System.out.println("Source compatibility smoke passed");
 }
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
}
