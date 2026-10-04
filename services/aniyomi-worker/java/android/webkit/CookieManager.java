package android.webkit;
import okhttp3.*;
import org.json.JSONObject;
import org.json.JSONArray;
import org.moa.apk.WebBridge;
import java.util.*;

/** Browser and APK HTTP requests share cookies, while each worker keeps its own jar. */
public final class CookieManager {
 private static final CookieManager instance=new CookieManager();
 private static CookieJar jar=CookieJar.NO_COOKIES;
 private boolean accept=true;
 private CookieManager(){}
 public static CookieManager getInstance(){return instance;}
 public static void bind(CookieJar value){jar=value;}
 public synchronized void setAcceptCookie(boolean value){accept=value;}
 public synchronized boolean acceptCookie(){return accept;}
 public void setCookie(String url,String value){
  if(!accept||value==null||value.isBlank())return;
  HttpUrl target=HttpUrl.get(url);Cookie cookie=Cookie.parse(target,value);if(cookie==null)return;
  WebBridge.call(new JSONObject().put("method","cookies.set").put("url",url).put("cookie",encode(cookie)));
  jar.saveFromResponse(target,List.of(cookie));
 }
 public void setCookie(String url,String value,ValueCallback<Boolean> callback){setCookie(url,value);if(callback!=null)callback.onReceiveValue(true);}
 public String getCookie(String url){
  var cookies=WebBridge.call(new JSONObject().put("method","cookies.get").put("url",url)).getJSONArray("cookies");
  merge(cookies);List<String> parts=new ArrayList<>();for(int i=0;i<cookies.length();i++){var c=cookies.getJSONObject(i);parts.add(c.getString("name")+"="+c.getString("value"));}
  return parts.isEmpty()?null:String.join("; ",parts);
 }
 public void flush(){WebBridge.call(new JSONObject().put("method","cookies.flush"));}
 public static JSONArray seed(String url){var result=new JSONArray();for(Cookie cookie:jar.loadForRequest(HttpUrl.get(url)))result.put(encode(cookie));return result;}
 private static JSONObject encode(Cookie c){return new JSONObject().put("name",c.name()).put("value",c.value()).put("domain",(c.hostOnly()?"":".")+c.domain()).put("path",c.path()).put("expires",c.persistent()?c.expiresAt()/1000.0:-1).put("secure",c.secure()).put("httpOnly",c.httpOnly()).put("sameSite","Lax");}
 public static void merge(JSONArray cookies){
  for(int i=0;i<cookies.length();i++){
   var c=cookies.getJSONObject(i);String domain=c.getString("domain");
   var builder=new Cookie.Builder().name(c.getString("name")).value(c.getString("value")).path(c.getString("path"));
   if(domain.startsWith("."))builder.domain(domain.substring(1));else builder.hostOnlyDomain(domain);
   if(c.optBoolean("secure"))builder.secure();if(c.optBoolean("httpOnly"))builder.httpOnly();
   double expires=c.optDouble("expires",-1);if(expires>=0)builder.expiresAt((long)(expires*1000));
   Cookie cookie=builder.build();jar.saveFromResponse(HttpUrl.get((cookie.secure()?"https://":"http://")+cookie.domain()+cookie.path()),List.of(cookie));
  }
 }
}
