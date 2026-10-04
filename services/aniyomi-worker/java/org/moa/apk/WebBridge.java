package org.moa.apk;
import org.json.JSONObject;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.function.Supplier;

/** Private loopback bridge supplied by the supervisor; source URLs never become RPC endpoints. */
public final class WebBridge {
 private static Supplier<String> proxy=()->"";
 private static final class Transport {
  static final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
 }
 public static void configure(Supplier<String> value){proxy=value;}
 public static JSONObject call(JSONObject input){
  String target=System.getenv("MOA_WEBVIEW_URL"),token=System.getenv("MOA_WEBVIEW_TOKEN");
  if(target==null||token==null)throw new UnsupportedOperationException("webview_unavailable");
  try {
   URI uri=URI.create(target);
   if(!"http".equals(uri.getScheme())||!"127.0.0.1".equals(uri.getHost()))throw new IllegalArgumentException();
   input.put("proxy",proxy.get());
   var req=HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(25)).header("Authorization","Bearer "+token).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(input.toString())).build();
   var response=Transport.client.send(req,HttpResponse.BodyHandlers.ofInputStream());
   byte[] bytes;try(var in=response.body()){bytes=in.readNBytes(2*1024*1024+1);}
   if(bytes.length>2*1024*1024)throw new IllegalStateException();
   var data=new JSONObject(new String(bytes,java.nio.charset.StandardCharsets.UTF_8));
   if(response.statusCode()!=200||data.has("error"))throw new IllegalStateException("webview_request_failed");
   return data.getJSONObject("result");
  }catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalStateException("webview_cancelled");}
  catch(Exception e){throw new IllegalStateException("webview_request_failed");}
 }
}
