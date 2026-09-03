// School Admin course authoring: Courses -> Modules -> Lessons, each
// lesson editable via lessonEditorModal.js (video/PDF/quiz). List view
// and a course-detail view are both rendered into the same container,
// swapped by re-rendering rather than a real router — consistent with
// how every other multi-panel tool in this app works.
import { confirmDialog } from './confirmDialog.js';
import { createLessonEditorModal } from './lessonEditorModal.js';
import { createCourseCreditModal } from './courseCreditModal.js';
import { t } from '../i18n.js';

export function renderCourseBuilder(container, { supabase, currentUserId }) {
  let view = 'list';
  let activeCourseId = null;
  const lessonEditor = createLessonEditorModal({ supabase, onSaved: () => renderDetail(activeCourseId) });
  const creditModal = createCourseCreditModal({ supabase });

  renderList();

  async function renderList() {
    view = 'list';
    container.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">${t('courses.manageTitle')}</h2>
        <button type="button" data-action="new-course" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('courses.newCourse')}
        </button>
      </div>
      <div data-el="list" class="bg-white rounded-xl shadow divide-y divide-slate-100"></div>
    `;

    container.querySelector('[data-action="new-course"]').addEventListener('click', async () => {
      const title = window.prompt(t('courses.newCoursePrompt'));
      if (!title?.trim()) return;
      const { data, error } = await supabase.from('courses').insert({ title: title.trim(), created_by: currentUserId }).select('id').single();
      if (error) { window.alert(t('courses.saveFailed', { message: error.message })); return; }
      renderDetail(data.id);
    });

    const listEl = container.querySelector('[data-el="list"]');
    const { data: courses, error } = await supabase.from('courses').select('id, title, published').order('title');
    if (error) {
      listEl.innerHTML = `<p class="p-4 text-rose-600 text-sm">${t('courses.loadFailed', { message: error.message })}</p>`;
      return;
    }
    if ((courses || []).length === 0) {
      listEl.innerHTML = `<p class="p-4 text-slate-500 text-sm">${t('courses.none')}</p>`;
      return;
    }

    listEl.innerHTML = courses.map((c) => `
      <div class="flex items-center justify-between p-4">
        <div class="flex items-center gap-2">
          <span class="font-medium text-slate-800">${escapeHtml(c.title)}</span>
          <span class="text-xs px-2 py-0.5 rounded-full ${c.published ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">
            ${c.published ? t('courses.published') : t('courses.draft')}
          </span>
        </div>
        <button type="button" data-course-id="${c.id}" class="text-sm font-medium text-indigo-600 hover:text-indigo-800">${t('courses.manage')}</button>
      </div>
    `).join('');
    listEl.querySelectorAll('[data-course-id]').forEach((btn) => {
      btn.addEventListener('click', () => renderDetail(btn.dataset.courseId));
    });
  }

  async function renderDetail(courseId) {
    view = 'detail';
    activeCourseId = courseId;
    container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const [{ data: course, error: courseError }, { data: modules, error: modulesError }] = await Promise.all([
      supabase.from('courses').select('id, title, description, published').eq('id', courseId).single(),
      supabase.from('course_modules').select('id, title, position').eq('course_id', courseId).order('position'),
    ]);

    if (courseError) {
      container.innerHTML = `<p class="text-sm text-rose-600">${t('courses.loadFailed', { message: courseError.message })}</p>`;
      return;
    }

    const moduleIds = (modules || []).map((m) => m.id);
    const { data: lessons } = moduleIds.length > 0
      ? await supabase.from('lessons').select('id, module_id, title, video_source, video_url, video_storage_path, video_provider, pdf_storage_path, pdf_file_name, position').in('module_id', moduleIds).order('position')
      : { data: [] };
    const lessonsByModule = new Map();
    (lessons || []).forEach((l) => {
      if (!lessonsByModule.has(l.module_id)) lessonsByModule.set(l.module_id, []);
      lessonsByModule.get(l.module_id).push(l);
    });

    container.innerHTML = `
      <button type="button" data-action="back" class="text-sm text-indigo-600 hover:text-indigo-800 mb-4">${t('courses.backToList')}</button>

      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6 space-y-3">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('courses.title')}</label>
          <input type="text" data-el="course-title" value="${escapeAttr(course.title)}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('courses.description')}</label>
          <textarea data-el="course-description" rows="2" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">${escapeHtml(course.description || '')}</textarea>
        </div>
        <label class="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" data-el="course-published" ${course.published ? 'checked' : ''} /> ${t('courses.publishedLabel')}
        </label>
        <div class="flex items-center gap-3">
          <button type="button" data-action="save-course" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('courses.save')}</button>
          <button type="button" data-action="delete-course" class="px-4 py-2 rounded-lg text-rose-600 font-medium hover:bg-rose-50">${t('courses.deleteCourse')}</button>
          <span data-el="course-status" class="text-sm text-slate-500"></span>
        </div>
      </div>

      <div data-el="modules"></div>

      <div class="mt-4 flex flex-wrap gap-3">
        <button type="button" data-action="add-module" class="px-4 py-2 rounded-lg bg-slate-700 text-white font-medium hover:bg-slate-800">
          ${t('courses.addModule')}
        </button>
        <button type="button" data-action="grant-credit" class="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700">
          ${t('courses.grantCreditTitle')}
        </button>
      </div>
    `;

    container.querySelector('[data-action="back"]').addEventListener('click', renderList);
    container.querySelector('[data-action="save-course"]').addEventListener('click', () => saveCourse(courseId));
    container.querySelector('[data-action="delete-course"]').addEventListener('click', () => deleteCourse(courseId, course.title));
    container.querySelector('[data-action="add-module"]').addEventListener('click', () => addModule(courseId, (modules || []).length));
    container.querySelector('[data-action="grant-credit"]').addEventListener('click', () => creditModal.open({ id: courseId, title: course.title }));

    const modulesEl = container.querySelector('[data-el="modules"]');
    if ((modules || []).length === 0) {
      modulesEl.innerHTML = `<p class="text-sm text-slate-500">${t('courses.noModules')}</p>`;
    } else {
      modulesEl.innerHTML = '';
      modules.forEach((m) => modulesEl.appendChild(renderModule(m, lessonsByModule.get(m.id) || [])));
    }
  }

  function renderModule(courseModule, lessons) {
    const details = document.createElement('details');
    details.className = 'bg-white rounded-xl shadow mb-3';
    details.innerHTML = `
      <summary class="flex items-center justify-between p-4 cursor-pointer select-none">
        <span class="font-medium text-slate-800">${escapeHtml(courseModule.title)}</span>
        <span class="text-xs text-slate-400">${t('courses.lessonCount', { count: lessons.length })}</span>
      </summary>
      <div class="border-t border-slate-100 p-4 space-y-3">
        <div class="flex items-center gap-2">
          <input type="text" data-el="module-title" value="${escapeAttr(courseModule.title)}" class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          <input type="number" data-el="module-position" value="${courseModule.position}" class="w-16 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" title="${escapeAttr(t('courses.position'))}" />
          <button type="button" data-action="save-module" class="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800">${t('courses.save')}</button>
          <button type="button" data-action="delete-module" class="px-3 py-1.5 rounded-lg text-rose-600 text-sm font-medium hover:bg-rose-50">${t('courses.delete')}</button>
        </div>
        <div data-el="lessons" class="space-y-2"></div>
        <button type="button" data-action="add-lesson" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
          ${t('courses.addLesson')}
        </button>
      </div>
    `;

    details.querySelector('[data-action="save-module"]').addEventListener('click', async () => {
      const title = details.querySelector('[data-el="module-title"]').value.trim();
      const position = Number(details.querySelector('[data-el="module-position"]').value) || 0;
      if (!title) return;
      await supabase.from('course_modules').update({ title, position }).eq('id', courseModule.id);
      renderDetail(activeCourseId);
    });

    details.querySelector('[data-action="delete-module"]').addEventListener('click', async () => {
      const confirmed = await confirmDialog({ message: t('courses.confirmDeleteModule', { title: courseModule.title }) });
      if (!confirmed) return;
      await supabase.from('course_modules').delete().eq('id', courseModule.id);
      renderDetail(activeCourseId);
    });

    details.querySelector('[data-action="add-lesson"]').addEventListener('click', () => addLesson(courseModule.id, lessons.length));

    const lessonsEl = details.querySelector('[data-el="lessons"]');
    if (lessons.length === 0) {
      lessonsEl.innerHTML = `<p class="text-xs text-slate-400">${t('courses.noLessons')}</p>`;
    } else {
      lessons.forEach((l) => lessonsEl.appendChild(renderLessonRow(l)));
    }

    return details;
  }

  function renderLessonRow(lesson) {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2';
    row.innerHTML = `
      <div class="text-sm">
        <span class="font-medium text-slate-700">${escapeHtml(lesson.title)}</span>
        <span class="text-xs text-slate-400 ml-2">
          ${lesson.video_source ? t('courses.hasVideo') : ''}${lesson.pdf_storage_path ? ` · ${t('courses.hasPdf')}` : ''}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <button type="button" data-action="edit-lesson" class="text-sm font-medium text-indigo-600 hover:text-indigo-800">${t('courses.edit')}</button>
        <button type="button" data-action="delete-lesson" class="text-sm font-medium text-rose-600 hover:text-rose-800">${t('courses.delete')}</button>
      </div>
    `;
    row.querySelector('[data-action="edit-lesson"]').addEventListener('click', () => lessonEditor.open(lesson));
    row.querySelector('[data-action="delete-lesson"]').addEventListener('click', async () => {
      const confirmed = await confirmDialog({ message: t('courses.confirmDeleteLesson', { title: lesson.title }) });
      if (!confirmed) return;
      if (lesson.video_source === 'upload' && lesson.video_storage_path) {
        if (lesson.video_provider === 'r2') {
          await supabase.functions.invoke('course-video-r2', { body: { action: 'delete', object_key: lesson.video_storage_path } });
        } else {
          await supabase.storage.from('course-videos').remove([lesson.video_storage_path]);
        }
      }
      if (lesson.pdf_storage_path) await supabase.storage.from('course-pdfs').remove([lesson.pdf_storage_path]);
      await supabase.from('lessons').delete().eq('id', lesson.id);
      renderDetail(activeCourseId);
    });
    return row;
  }

  async function saveCourse(courseId) {
    const statusEl = container.querySelector('[data-el="course-status"]');
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.saving');

    const title = container.querySelector('[data-el="course-title"]').value.trim();
    const description = container.querySelector('[data-el="course-description"]').value.trim();
    const published = container.querySelector('[data-el="course-published"]').checked;

    const { error } = await supabase.from('courses').update({ title, description: description || null, published, updated_at: new Date().toISOString() }).eq('id', courseId);
    if (error) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('courses.saveFailed', { message: error.message });
      return;
    }
    statusEl.className = 'text-sm text-emerald-600';
    statusEl.textContent = t('courses.saved');
  }

  async function deleteCourse(courseId, title) {
    const confirmed = await confirmDialog({ message: t('courses.confirmDeleteCourse', { title }) });
    if (!confirmed) return;
    const { error } = await supabase.from('courses').delete().eq('id', courseId);
    if (error) { window.alert(t('courses.saveFailed', { message: error.message })); return; }
    renderList();
  }

  async function addModule(courseId, existingCount) {
    const title = window.prompt(t('courses.newModulePrompt'));
    if (!title?.trim()) return;
    const { error } = await supabase.from('course_modules').insert({ course_id: courseId, title: title.trim(), position: existingCount });
    if (error) { window.alert(t('courses.saveFailed', { message: error.message })); return; }
    renderDetail(courseId);
  }

  async function addLesson(moduleId, existingCount) {
    const title = window.prompt(t('courses.newLessonPrompt'));
    if (!title?.trim()) return;
    const { data, error } = await supabase.from('lessons').insert({ module_id: moduleId, title: title.trim(), position: existingCount }).select().single();
    if (error) { window.alert(t('courses.saveFailed', { message: error.message })); return; }
    await renderDetail(activeCourseId);
    lessonEditor.open(data);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
