package android.graphics;
public final class Color {
 public static final int BLACK=0xff000000, WHITE=0xffffffff, TRANSPARENT=0;
 public static int rgb(int r,int g,int b) { return argb(255,r,g,b); }
 public static int argb(int a,int r,int g,int b) { return (a&255)<<24|(r&255)<<16|(g&255)<<8|(b&255); }
 public static int parseColor(String v) { if(v.matches("#[0-9a-fA-F]{6}"))return (int)(0xff000000L|Long.parseLong(v.substring(1),16));if(v.matches("#[0-9a-fA-F]{8}"))return (int)Long.parseLong(v.substring(1),16);throw new IllegalArgumentException("color_unsupported"); }
}
