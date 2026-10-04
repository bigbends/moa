package android.graphics;
import java.awt.image.BufferedImage;
import java.io.OutputStream;
import javax.imageio.ImageIO;
/** Bounded raster implementation for extension-generated guide/channel cards. No Android UI. */
public final class Bitmap {
 public enum Config { ARGB_8888 }
 public enum CompressFormat { PNG, JPEG, WEBP }
 final BufferedImage image;
 private Bitmap(int w,int h) { if(w<1||h<1||w>4096||h>4096||(long)w*h>8_000_000) throw new IllegalArgumentException("bitmap_limit"); image=new BufferedImage(w,h,BufferedImage.TYPE_INT_ARGB); }
 public static Bitmap createBitmap(int w,int h,Config config) { return new Bitmap(w,h); }
 public boolean compress(CompressFormat format,int quality,OutputStream output) {
  if(format!=CompressFormat.PNG) throw new UnsupportedOperationException("bitmap_format_unsupported");
  try { return ImageIO.write(image,"png",output); } catch(java.io.IOException e) { return false; }
 }
 public int getWidth() { return image.getWidth(); } public int getHeight() { return image.getHeight(); }
 public void recycle() { image.flush(); }
}
