package org.moa.apk;

import okhttp3.Headers;
import okhttp3.HttpUrl;
/** Match browser URL serialization for Unicode Referer/Origin. All other header validation remains intact. */
public final class UrlHeaders {
  public static String normalize(String name, String value) {
    if (!("Referer".equalsIgnoreCase(name) || "Origin".equalsIgnoreCase(name)) || value == null) return value;
    boolean unicode = false;
    for (int i=0;i<value.length();i++) {
      char c=value.charAt(i);
      if(c<32 || c==127) return value; // Never hide control characters from OkHttp's normal rejection.
      if(c>127) unicode=true;
    }
    if(!unicode) return value;
    try { return HttpUrl.get(value).toString(); } catch(IllegalArgumentException e) { return value; }
  }
  public static Headers.Builder set(Headers.Builder builder,String name,String value) { return builder.set(name,normalize(name,value)); }
  public static Headers.Builder add(Headers.Builder builder,String name,String value) { return builder.add(name,normalize(name,value)); }
}
