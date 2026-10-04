package android.graphics;
public class Paint {
 public enum Align { LEFT,CENTER,RIGHT }
 public static final int ANTI_ALIAS_FLAG=1;
 int color=Color.BLACK;float textSize=16;Align align=Align.LEFT;Typeface face=Typeface.DEFAULT;Shader shader;
 public Paint() {} public Paint(int flags) {}
 public void setColor(int value) { color=value; }
 public void setTextSize(float value) { if(!Float.isFinite(value)||value<0||value>4096)throw new IllegalArgumentException("font_size");textSize=value; }
 public void setTextAlign(Align value) { align=value; }
 public Typeface setTypeface(Typeface value) { Typeface old=face;face=value==null?Typeface.DEFAULT:value;return old; }
 public Shader setShader(Shader value) { Shader old=shader;shader=value;return old; }
 java.awt.Font font() { return new java.awt.Font(java.awt.Font.SANS_SERIF,face.style,Math.max(1,Math.round(textSize))).deriveFont(textSize); }
 private java.awt.font.FontRenderContext context() { return new java.awt.font.FontRenderContext(null,true,true); }
 public float measureText(String text) { return (float)font().getStringBounds(text,context()).getWidth(); }
 public float ascent() { return -font().getLineMetrics("Hg",context()).getAscent(); }
 public float descent() { return font().getLineMetrics("Hg",context()).getDescent(); }
}
