package ru.metroom.notebook;

import android.app.AlertDialog;
import android.text.InputFilter;
import android.text.InputType;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.net.URI;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/** Native surfaces are the only views that receive share text, file names or recipient details. */
final class NotebookShareDialogs implements NotebookShareManager.Listener {
    private final MainActivity activity;
    private final NotebookShareManager manager;
    private final ArrayDeque<UUID> prompts = new ArrayDeque<>();
    private AlertDialog current;
    private ArrayAdapter<String> queueAdapter;
    private List<NotebookShareRecord> rows = Collections.emptyList();
    private Runnable updateRecipient;
    private boolean closed;

    NotebookShareDialogs(MainActivity activity, NotebookShareManager manager) {
        this.activity = activity;
        this.manager = manager;
    }

    @Override
    public void received(UUID id) {
        prompts.addLast(id);
        showNext();
    }

    @Override
    public void changed() {
        if (queueAdapter != null) refreshQueue();
        if (updateRecipient != null) updateRecipient.run();
    }

    @Override
    public void message(String text) {
        if (!closed && !activity.isFinishing()) Toast.makeText(activity, text, Toast.LENGTH_SHORT).show();
    }

    void showQueue() {
        if (closed || activity.isFinishing() || current != null) return;
        var adapter = new ArrayAdapter<String>(activity, android.R.layout.simple_list_item_1, new ArrayList<>());
        queueAdapter = adapter;
        AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle("Очередь «Сохранённого»")
                .setAdapter(adapter, (ignored, index) -> {
                    if (index >= rows.size()) return;
                    NotebookShareRecord entry = rows.get(index);
                    dismissCurrent();
                    if (entry.status == NotebookShareRecord.Status.DRAFT) showCapture(entry);
                    else showStatus(entry);
                })
                .setNeutralButton("Проверить отправку", null)
                .setNegativeButton("Закрыть", null)
                .create();
        attach(dialog);
        dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(view -> manager.requestSync());
        refreshQueue();
        manager.requestSync();
    }

    private void refreshQueue() {
        final var adapter = queueAdapter;
        manager.list(entries -> {
            if (adapter == null || queueAdapter != adapter || current == null) return;
            rows = entries;
            current.setTitle("Очередь «Сохранённого» · " + entries.size());
            var account = manager.currentAccount();
            adapter.clear();
            if (entries.isEmpty()) adapter.add("Нет материалов на устройстве");
            for (var entry : entries) adapter.add(entry.label() + "\n" + status(entry, account));
        });
    }

    private void showNext() {
        if (closed || current != null || prompts.isEmpty() || activity.isFinishing()) return;
        UUID id = prompts.removeFirst();
        manager.list(entries -> {
            if (closed) return;
            if (current != null) { prompts.addFirst(id); return; }
            for (var entry : entries) {
                if (entry.id.equals(id) && entry.status == NotebookShareRecord.Status.DRAFT) { showCapture(entry); return; }
            }
            showNext();
        });
    }

    private void showCapture(NotebookShareRecord entry) {
        LinearLayout fields = column();
        label(fields, "Сохранено на устройстве");
        if (!entry.url.isEmpty()) label(fields, "Источник: " + entry.url);
        if (!entry.text.trim().isEmpty()) label(fields, excerpt(entry.text, 420));
        for (var file : entry.files) label(fields, file.name);
        EditText title = edit(fields, "Название", entry.draftTitle(), 200, false);
        var titleEdited = new java.util.concurrent.atomic.AtomicBoolean();
        title.addTextChangedListener(new android.text.TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence value, int start, int before, int count) { titleEdited.set(true); }
            @Override public void afterTextChanged(android.text.Editable value) {}
        });
        EditText comment = edit(fields, "Комментарий (необязательно)", entry.comment, 2_000, true);
        EditText tags = edit(fields, "Теги через пробел или запятую", android.text.TextUtils.join(", ", entry.tags), 3_500, false);
        TextView target = label(fields, "");
        NotebookShareSync.Account[] offered = new NotebookShareSync.Account[1];
        updateRecipient = () -> {
            offered[0] = entry.accountId.isEmpty() ? manager.currentAccount() : null;
            target.setText(recipient(entry, offered[0]));
        };
        updateRecipient.run();
        var remove = new android.widget.Button(activity);
        remove.setText("Удалить с устройства");
        remove.setOnClickListener(view -> { dismissCurrent(); confirmDelete(entry); });
        fields.addView(remove);
        AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle("Добавить в «Сохранённое»")
                .setView(scroll(fields))
                .setPositiveButton("Сохранить", null)
                .setNeutralButton("Очередь", null)
                .setNegativeButton("Закрыть", null)
                .create();
        attach(dialog);
        dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(view -> { dismissCurrent(); showQueue(); });
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            try {
                String note = NotebookShareInput.text(comment.getText()).trim();
                int combined = entry.text.length() + (note.isEmpty() ? 0 : note.length() + (entry.text.isEmpty() ? 0 : 2));
                if (combined > NotebookShareInput.MAX_TEXT) { comment.setError("Сократите комментарий: превышен лимит текста."); return; }
                var labels = NotebookShareInput.tags(tags.getText().toString());
                view.setEnabled(false);
                manager.confirm(entry.id, NotebookShareInput.title(title.getText()), titleEdited.get(), note, labels, offered[0], saved -> {
                    if (!dialog.isShowing()) return;
                    if (saved) dialog.dismiss();
                    else view.setEnabled(true);
                });
            } catch (IllegalArgumentException invalid) {
                tags.setError(invalid.getMessage());
            }
        });
        dialog.getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
    }

    private void showStatus(NotebookShareRecord entry) {
        var account = manager.currentAccount();
        String message = status(entry, account) + "\n\n" + recipient(entry, account);
        if (entry.status == NotebookShareRecord.Status.CONFLICT) message += "\nСервер обнаружил конфликт ключа. Локальная копия сохранена.";
        if (entry.status == NotebookShareRecord.Status.TOO_LARGE) message += "\nСервер отклонил размер материала.";
        if (entry.status == NotebookShareRecord.Status.ACCESS) message += "\nПроверьте права доступа или смену временного пароля.";
        var builder = new AlertDialog.Builder(activity).setTitle(entry.label()).setMessage(message)
                .setNegativeButton("Закрыть", null)
                .setNeutralButton("Удалить", (dialog, which) -> {
                    dismissCurrent();
                    confirmDelete(entry);
                });
        if (!manager.isSending(entry.id) && entry.status != NotebookShareRecord.Status.CONFLICT) {
            if (entry.accountId.isEmpty() && account != null) {
                builder.setPositiveButton("Выбрать получателя", (dialog, which) -> confirmRecipient(entry, account));
            } else if (account != null && account.owns(entry)) {
                builder.setPositiveButton("Повторить", (dialog, which) -> manager.retry(entry.id));
            } else {
                builder.setPositiveButton("Проверить вход", (dialog, which) -> manager.requestSync());
            }
        }
        attach(builder.create());
    }

    private void confirmRecipient(NotebookShareRecord entry, NotebookShareSync.Account account) {
        dismissCurrent();
        attach(new AlertDialog.Builder(activity).setTitle("Выбрать получателя")
                .setMessage(account.name + "\n" + account.server.base)
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Отправить", (dialog, which) -> manager.assign(entry.id, account)).create());
    }

    private void confirmDelete(NotebookShareRecord entry) {
        attach(new AlertDialog.Builder(activity).setTitle("Удалить локальный материал?")
                .setMessage("«" + excerpt(entry.label(), 100) + "» будет удалён с устройства.")
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Удалить", (dialog, which) -> manager.remove(entry.id)).create());
    }

    private String status(NotebookShareRecord entry, NotebookShareSync.Account account) {
        if (manager.isSending(entry.id)) return "Отправляется";
        switch (entry.status) {
            case DRAFT: return "Сохранено на устройстве · Черновик";
            case AUTH: return "Требуется вход";
            case ACCESS: case CONFLICT: case TOO_LARGE: case ERROR: return "Ошибка отправки";
            case SENT: return "Сохранено в Блокнот";
            default:
                if (entry.accountId.isEmpty()) return account == null ? "Требуется вход" : "Выберите получателя";
                if (account == null && manager.waitingForNetwork(entry)) return "Ожидает отправки";
                return account == null || !account.owns(entry) ? "Требуется вход" : "Ожидает отправки";
        }
    }

    private static String recipient(NotebookShareRecord entry, NotebookShareSync.Account offered) {
        if (!entry.accountId.isEmpty()) return "Получатель: " + entry.accountName + "\n" + entry.server;
        if (offered != null) return "Получатель: " + offered.name + "\n" + offered.server.base;
        return "Требуется вход. Материал останется на устройстве до выбора получателя.";
    }

    private void attach(AlertDialog dialog) {
        current = dialog;
        dialog.setOnDismissListener(ignored -> {
            if (current != dialog) return;
            current = null;
            queueAdapter = null;
            updateRecipient = null;
            activity.getWindow().getDecorView().post(this::showNext);
        });
        dialog.show();
    }

    private void dismissCurrent() {
        var dialog = current;
        current = null;
        queueAdapter = null;
        updateRecipient = null;
        if (dialog != null) dialog.dismiss();
    }

    void close() {
        closed = true;
        prompts.clear();
        dismissCurrent();
    }

    private LinearLayout column() {
        var layout = new LinearLayout(activity);
        layout.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (24 * activity.getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding / 2, padding, padding / 2);
        return layout;
    }

    private View scroll(LinearLayout fields) {
        var scroll = new ScrollView(activity);
        scroll.addView(fields);
        return scroll;
    }

    private TextView label(LinearLayout parent, String text) {
        var view = new TextView(activity);
        view.setText(text);
        parent.addView(view);
        return view;
    }

    private EditText edit(LinearLayout parent, String hint, String value, int max, boolean multiline) {
        var edit = new EditText(activity);
        edit.setHint(hint);
        edit.setInputType(InputType.TYPE_CLASS_TEXT | (multiline ? InputType.TYPE_TEXT_FLAG_MULTI_LINE : InputType.TYPE_TEXT_FLAG_CAP_SENTENCES));
        if (!multiline) edit.setSingleLine();
        edit.setFilters(new InputFilter[]{new InputFilter.LengthFilter(max)});
        edit.setText(value);
        parent.addView(edit);
        return edit;
    }

    private static String excerpt(String value, int limit) {
        return value.length() <= limit ? value : value.substring(0, limit) + "…";
    }
}
