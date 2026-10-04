package org.moa.apk

import eu.kanade.tachiyomi.animesource.model.AnimeFilter
import eu.kanade.tachiyomi.animesource.model.AnimeFilterList
import org.json.JSONArray
import org.json.JSONObject

/** Keep the original subclass instances: extensions may inspect their types and custom fields. */
fun sourceFilters(filters: AnimeFilterList, changes: JSONArray): JSONArray {
    require(filters.size <= 256 && changes.length() <= 512)
    val result = JSONArray()
    val used = mutableSetOf<Int>()
    fun visit(filter: AnimeFilter<*>, position: Int, groupPosition: Int? = null) {
        val row = JSONObject().put("id", "$position:${groupPosition ?: ""}")
            .put("position", position).put("label", filter.name)
        if (groupPosition != null) row.put("groupPosition", groupPosition)
        var changed: Any? = null
        for (i in 0 until changes.length()) {
            val change = changes.getJSONObject(i)
            if (change.getInt("position") == position &&
                (if (change.has("groupPosition")) change.getInt("groupPosition") else null) == groupPosition) {
                require(used.add(i)); changed = change.get("value")
            }
        }
        when (filter) {
            is AnimeFilter.Group<*> -> {
                require(groupPosition == null && changed == null)
                result.put(row.put("kind", "header"))
                filter.state.forEachIndexed { index, child -> visit(child as AnimeFilter<*>, position, index) }
                return
            }
            is AnimeFilter.Header -> { require(changed == null); row.put("kind", "header") }
            is AnimeFilter.Separator -> { require(changed == null); row.put("kind", "separator") }
            is AnimeFilter.CheckBox -> {
                row.put("kind", "checkbox").put("defaultValue", filter.state)
                if (changed != null) { require(changed is Boolean); filter.state = changed }
            }
            is AnimeFilter.TriState -> {
                val states = listOf("IGNORE", "INCLUDE", "EXCLUDE")
                row.put("kind", "tri_state").put("defaultValue", states[filter.state])
                if (changed != null) { require(changed in states); filter.state = states.indexOf(changed) }
            }
            is AnimeFilter.Text -> {
                row.put("kind", "text").put("defaultValue", filter.state)
                if (changed != null) { require(changed is String && changed.length <= 2000); filter.state = changed }
            }
            is AnimeFilter.Select<*> -> {
                row.put("kind", "select").put("options", JSONArray(filter.values.map { it.toString() })).put("defaultValue", filter.state)
                if (changed != null) { require(changed is Int && changed in filter.values.indices); filter.state = changed }
            }
            is AnimeFilter.Sort -> {
                val state = filter.state ?: AnimeFilter.Sort.Selection(0, false)
                row.put("kind", "sort").put("options", JSONArray(filter.values.toList()))
                    .put("defaultValue", JSONObject().put("index", state.index).put("ascending", state.ascending))
                if (changed != null) {
                    require(changed is JSONObject && changed.getInt("index") in filter.values.indices)
                    filter.state = AnimeFilter.Sort.Selection(changed.getInt("index"), changed.getBoolean("ascending"))
                }
            }
            else -> error("compatibility_filter_unsupported")
        }
        result.put(row)
        require(result.length() <= 8192)
    }
    filters.forEachIndexed { index, filter -> visit(filter, index) }
    require(used.size == changes.length())
    return result
}
