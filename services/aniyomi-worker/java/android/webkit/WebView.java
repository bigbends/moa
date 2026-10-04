package android.webkit;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import org.json.*;
import org.moa.apk.WebBridge;
import java.util.*;
import java.util.concurrent.*;

/** Headless subset: navigation, page-finished callbacks, JS evaluation and shared cookies. */
public class WebView {
 private final String id=UUID.randomUUID().toString();
 private final WebSettings settings=new WebSettings();
 private final Handler callbacks=new Handler(Looper.getMainLooper());
 private final ExecutorService io=Executors.newSingleThreadExecutor(r->{var t=new Thread(r,"moa-webview");t.setDaemon(true);return t;});
 private volatile WebViewClient client=new WebViewClient();
 private volatile boolean destroyed;
 private volatile String url,title;
 private volatile Future<?> loading;
 public WebView(Context context){}
 public WebSettings getSettings(){return settings;}
 public String getUrl(){return url;}
 public String getTitle(){return title;}
 public void setWebViewClient(WebViewClient value){
  if(value==null){client=new WebViewClient();return;}
  // Fail explicitly when a source requires interception instead of silently dropping its callbacks.
  for(var method:value.getClass().getMethods())if(method.getDeclaringClass()!=WebViewClient.class&&method.getName().equals("shouldInterceptRequest"))throw new UnsupportedOperationException("webview_interception_unsupported");
  client=value;
 }
 public void loadUrl(String value){loadUrl(value,Map.of());}
 public void loadUrl(String value,Map<String,String> headers){
  if(destroyed)throw new IllegalStateException("webview_destroyed");
  if(value.startsWith("javascript:")){evaluateJavascript(value.substring(11),null);return;}
  if(client.shouldOverrideUrlLoading(this,value))return;
  url=value;client.onPageStarted(this,value,null);
  loading=io.submit(()->{
   try{
    var input=base("load").put("url",value).put("headers",new JSONObject(headers)).put("cookies",CookieManager.seed(value))
     .put("javascript",settings.getJavaScriptEnabled()).put("domStorage",settings.getDomStorageEnabled());
    if(settings.getUserAgentString()!=null)input.put("userAgent",settings.getUserAgentString());
    var response=WebBridge.call(input);CookieManager.merge(response.getJSONArray("cookies"));url=response.getString("url");title=response.optString("title","");
    post(()->client.onPageFinished(this,url));
   }catch(Exception error){post(()->client.onReceivedError(this,-1,"webview_request_failed",value));}
  });
 }
 public void evaluateJavascript(String script,ValueCallback<String> callback){
  if(destroyed)throw new IllegalStateException("webview_destroyed");
  io.submit(()->{try{var result=WebBridge.call(base("evaluate").put("script",script));CookieManager.merge(result.getJSONArray("cookies"));if(callback!=null)post(()->callback.onReceiveValue(result.getString("json")));}
   catch(Exception error){post(()->client.onReceivedError(this,-1,"webview_request_failed",url));}});
 }
 private JSONObject base(String method){return new JSONObject().put("method",method).put("id",id);}
 private void post(Runnable fn){callbacks.post(()->{if(!destroyed)fn.run();});}
 public void stopLoading(){var pending=loading;if(pending!=null)pending.cancel(true);}
 public void destroy(){
  if(destroyed)return;destroyed=true;stopLoading();io.shutdownNow();callbacks.removeCallbacksAndMessages(null);
  // Avoid blocking the Android main dispatcher on browser cleanup.
  var thread=new Thread(()->{try{WebBridge.call(base("destroy"));}catch(Exception ignored){}},"moa-webview-close");thread.setDaemon(true);thread.start();
 }
 public void addJavascriptInterface(Object object,String name){throw new UnsupportedOperationException("webview_native_interface_unsupported");}
 public void removeJavascriptInterface(String name){}
}
