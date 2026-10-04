package android.webkit;
import android.graphics.Bitmap;
public class WebViewClient {
 public void onPageStarted(WebView view,String url,Bitmap icon){}
 public void onPageFinished(WebView view,String url){}
 public void onLoadResource(WebView view,String url){}
 public void onReceivedError(WebView view,int code,String description,String failingUrl){}
 public boolean shouldOverrideUrlLoading(WebView view,String url){return false;}
 public WebResourceResponse shouldInterceptRequest(WebView view,String url){return null;}
}
