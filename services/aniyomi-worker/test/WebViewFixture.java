import android.webkit.*;
import android.os.*;
import eu.kanade.tachiyomi.network.NetworkHelper;
import org.moa.apk.WebBridge;
import org.json.JSONObject;
import okhttp3.HttpUrl;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Runs against the real private broker + Chromium, with an explicitly permitted local fixture. */
public class WebViewFixture {
 public static void main(String[] args)throws Exception {
  String url=args[0];var helper=new NetworkHelper();CookieManager.bind(helper.getClient().cookieJar());WebBridge.configure(()->"");
  var cm=CookieManager.getInstance();cm.setCookie(url,"seed=before; Path=/");
  if(!cm.getCookie(url).contains("seed=before"))throw new AssertionError("cookie before browser");
  var handler=new Handler(Looper.getMainLooper());var done=new CountDownLatch(1);var failure=new AtomicReference<Throwable>();
  handler.post(()->{
   var view=new WebView(null);view.getSettings().setJavaScriptEnabled(true);view.getSettings().setDomStorageEnabled(true);
   view.setWebViewClient(new WebViewClient(){
    public void onReceivedError(WebView v,int code,String description,String target){failure.set(new AssertionError(description));v.destroy();done.countDown();}
    public void onPageFinished(WebView v,String target){
     try {
      if(!Looper.getMainLooper().isCurrentThread())throw new AssertionError("callback thread");
      if(!target.equals(url)||!v.getTitle().equals("fixture"))throw new AssertionError("navigation state");
      handler.postDelayed(()->{
       try {
        if(!cm.getCookie(url).contains("browser=ready"))throw new AssertionError("browser cookies");
        if(helper.getClient().cookieJar().loadForRequest(HttpUrl.get(url)).stream().noneMatch(c->c.name().equals("browser")))throw new AssertionError("HTTP cookie synchronization");
        v.evaluateJavascript("({answer:42,language:'한국어',saved:localStorage.getItem('saved'),seed:document.cookie.includes('seed=before')})",value->{
         try{var data=new JSONObject(value);if(data.getInt("answer")!=42||!data.getString("language").equals("한국어")||!data.getBoolean("seed")||!data.getString("saved").equals("yes"))throw new AssertionError("JS result");}
         catch(Throwable e){failure.set(e);}finally{v.destroy();done.countDown();}
        });
       }catch(Throwable e){failure.set(e);v.destroy();done.countDown();}
      },700);
     }catch(Throwable e){failure.set(e);v.destroy();done.countDown();}
    }
   });
   view.loadUrl(url);
  });
  if(!done.await(20,TimeUnit.SECONDS))throw new AssertionError("WebView callbacks timed out");
  if(failure.get()!=null)throw new AssertionError(failure.get());
  Thread.sleep(300);System.out.println("WebView navigation, callback thread, JS result and HTTP cookies passed");
 }
}
