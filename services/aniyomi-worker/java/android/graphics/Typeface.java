package android.graphics;
public final class Typeface {
 public static final Typeface DEFAULT=new Typeface(java.awt.Font.PLAIN);
 public static final int NORMAL=0,BOLD=1,ITALIC=2,BOLD_ITALIC=3;
 final int style;
 private Typeface(int style) { this.style=style; }
 public static Typeface create(Typeface family,int style) { return new Typeface(style&3); }
 public static Typeface create(String family,int style) { return new Typeface(style&3); }
}
