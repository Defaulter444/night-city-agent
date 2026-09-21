import { esc } from './clock.mjs';
import { ALLOWED_TYPES, shrinkImage } from './images.mjs';
import { documentImages, MAX_DOCUMENT_IMAGES } from './document-images.mjs';

/** Foundry 12 Dialog closes before asynchronous callbacks finish; this editor awaits saving. */
export function editDocumentDialog(doc, save, { authors, authorId = '' } = {}) {
  let images = documentImages(doc?.images), processing = false;
  return new Promise(resolve => {
    class DocumentDialog extends Dialog {
      async submit(button) {
        if (processing || this.saving) return;
        if (button !== this.data.buttons.save) return this.close();
        const root = this.element[0], form = root.querySelector('form');
        if (!form.reportValidity()) return;
        this.saving = true; setBusy(root, true);
        try {
          const fd = new FormData(form);
          const id = await save({ title: fd.get('title'), source: fd.get('source'), body: fd.get('body'), images: documentImages(images),
            ...(authors ? { authorId: fd.get('authorId') || null } : {}) });
          this.saving = false; resolve(id); await this.close();
        } catch (error) {
          this.saving = false; showError(root, error); setBusy(root, false);
        }
      }
      async close(options) {
        if (processing || this.saving) return;
        return super.close(options);
      }
    }
    const dialog = new DocumentDialog({
      title: doc ? 'Редактировать файл' : 'Новый файл',
      content: `<form class="nca-dialog nca-document-editor">
        <label>Название<input name="title" required maxlength="160" value="${esc(doc?.title || '')}"></label>
        <label>Источник<input name="source" maxlength="300" value="${esc(doc?.source || '')}"></label>
        ${authors ? `<label>Автор файла (может редактировать)<select name="authorId"><option value="">Только мастера</option>${authors.map(u => `<option value="${esc(u.id)}" ${u.id === authorId ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
        <p class="hint">У старых файлов автор не сохранялся. Выберите игрока, который создал файл, чтобы восстановить ему редактирование.</p>` : ''}
        ${doc ? '<p class="hint">Изменения этого файла увидят все, у кого уже есть к нему доступ.</p>' : ''}
        <label>Содержимое<textarea name="body" rows="7" maxlength="100000">${esc(doc?.body || '')}</textarea></label>
        <section class="nca-image-editor" aria-label="Изображения">
          <div class="nca-image-editor-heading"><strong>Изображения</strong><span class="nca-image-count" aria-live="polite"></span></div>
          <div class="nca-image-previews"></div>
          <button type="button" class="nca-add-images"><i class="fa-solid fa-images" aria-hidden="true"></i> Добавить картинки</button>
          <input type="file" class="nca-image-input" accept="${ALLOWED_TYPES.join(',')}" multiple hidden>
          <p class="hint">PNG, JPG, WebP и GIF · до 4 изображений, по 4 МБ, всего 8 МБ после сжатия. Большие снимки уменьшаются автоматически.</p>
        </section><p class="nca-image-error" role="alert" hidden></p>
      </form>`,
      buttons: { save: { label: 'Сохранить' }, cancel: { label: 'Отмена' } },
      default: 'save', close: () => resolve(null),
      render: html => {
        const root = html[0], input = root.querySelector('.nca-image-input');
        // Let Enter activate the focused attachment button instead of Dialog's default Save.
        root.addEventListener('keydown', event => {
          if (event.key === 'Enter' && event.target.closest('.nca-image-editor button')) event.stopPropagation();
        });
        const draw = () => {
          root.querySelector('.nca-image-count').textContent = `${images.length} / ${MAX_DOCUMENT_IMAGES}`;
          root.querySelector('.nca-image-previews').innerHTML = images.map((image, index) => `<figure>
            <img src="${esc(image.src)}" alt="${esc(image.name)}"><figcaption>${esc(image.name)}</figcaption>
            <button type="button" data-remove-image="${index}" aria-label="Удалить изображение ${esc(image.name)}"><i class="fa-solid fa-trash" aria-hidden="true"></i> Удалить</button>
          </figure>`).join('');
          root.querySelector('.nca-add-images').disabled = images.length >= MAX_DOCUMENT_IMAGES;
        };
        root.querySelector('.nca-add-images').addEventListener('click', () => input.click());
        root.querySelector('.nca-image-previews').addEventListener('click', event => {
          const button = event.target.closest('[data-remove-image]');
          if (!button || processing || dialog.saving) return;
          images.splice(Number(button.dataset.removeImage), 1); clearError(root); draw();
        });
        input.addEventListener('change', async () => {
          const files = Array.from(input.files ?? []); input.value = '';
          if (!files.length || processing || dialog.saving) return;
          processing = true; setBusy(root, true); clearError(root);
          try {
            if (images.length + files.length > MAX_DOCUMENT_IMAGES) throw Error(`В файл можно добавить до ${MAX_DOCUMENT_IMAGES} изображений`);
            const additions = [];
            for (const file of files) {
              if (!ALLOWED_TYPES.includes(file.type)) throw Error(`«${file.name}»: выберите PNG, JPG, WebP или GIF`);
              additions.push({ name: file.name, src: await shrinkImage(file) });
            }
            images = documentImages([...images, ...additions]);
          } catch (error) { showError(root, error); }
          finally { processing = false; setBusy(root, false); draw(); }
        });
        draw();
      }
    }, { width: 560, height: 'auto', resizable: true, classes: ['dialog', 'nca-document-dialog'] });
    dialog.render(true);
  });
}

function setBusy(root, busy) {
  root.querySelector('form').setAttribute('aria-busy', String(busy));
  for (const button of root.querySelectorAll('button')) button.disabled = busy;
}
function clearError(root) { root.querySelector('.nca-image-error').hidden = true; }
function showError(root, error) {
  const message = root.querySelector('.nca-image-error');
  message.textContent = error.message || 'Не удалось сохранить файл'; message.hidden = false;
}
