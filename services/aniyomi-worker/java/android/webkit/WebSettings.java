package android.webkit;
import android.content.Context;
/** Settings supported by the Chromium adapter; unsupported Android UI settings are not emulated. */
public final class WebSettings {
 private static final String DEFAULT_UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
 private String userAgent=DEFAULT_UA;
 private boolean javascript,domStorage;
 public void setJavaScriptEnabled(boolean value){javascript=value;}
 public boolean getJavaScriptEnabled(){return javascript;}
 public void setDomStorageEnabled(boolean value){domStorage=value;}
 public boolean getDomStorageEnabled(){return domStorage;}
 public void setUserAgentString(String value){if(value!=null&&value.length()>1024)throw new IllegalArgumentException();userAgent=(value==null||value.isEmpty())?DEFAULT_UA:value;}
 public String getUserAgentString(){return userAgent;}
 public static String getDefaultUserAgent(Context context){return DEFAULT_UA;}
}
