/**
 * config.js — 逐玉·古风形象生成 · Dify API 接入
 *
 * ⚠️  重要：本地直接双击打开 HTML 会遇到跨域限制（CORS），导致 API 无法调用。
 *     解决方法（二选一，都很简单）：
 *
 *     方法一：VS Code 安装 "Live Server" 插件
 *             右键 index.html → Open with Live Server
 *             浏览器会自动打开 http://127.0.0.1:5500/index.html
 *
 *     方法二：打开 cmd / 终端，进入网页文件夹，运行：
 *             python -m http.server 8080
 *             然后浏览器访问 http://localhost:8080/index.html
 *
 *     两种方法都不需要任何服务器，就在本地电脑上跑。
 */

// ─── 接口基础地址 ───────────────────────────────────────────
const DIFY_BASE = 'https://api.dify.ai/v1';

// ─── 三个工作流的 API Key ───────────────────────────────────
const API_KEYS = {
  image: 'app-B3qHIIoQULNcUCLwsKGPbGP8',  // 生成同人图
  novel: 'app-sc7yq9oYCYQr2edgCNAjDa4C',  // 生成同人文
  cp:    'app-nfMJfMO7nt7g7GJjHjr6pCLO',  // 生成 CP 合照
};

// ─── 模板图片 URL 对照表 ────────────────────────────────────
const TOS = 'https://cp-images.tos-cn-beijing.volces.com/zhuyu';
const TEMPLATES = {
  female: [
    TOS + '/template_zhuyu_female_1.jpg',
    TOS + '/template_zhuyu_female_2.jpg',
    TOS + '/template_zhuyu_female_3.jpg',
    TOS + '/template_zhuyu_female_4.jpg',
    TOS + '/template_zhuyu_female_5.jpg',
    TOS + '/template_zhuyu_female_6.jpg',
    TOS + '/template_zhuyu_female_7.jpg',
  ],
  male: [
    TOS + '/template_zhuyu_male_1.jpg',
    TOS + '/template_zhuyu_male_2.jpg',
    TOS + '/template_zhuyu_male_3.jpg',
    TOS + '/template_zhuyu_male_4.jpg',
    TOS + '/template_zhuyu_male_5.jpg',
  ],
};

// ─── 剧集名称映射 ───────────────────────────────────────────
const DRAMA_NAMES = ['逐风玉恋'];

// ─── Dify workflow 只接受这些固定值 ────────────────────────
// 若用户选了「自定义」并填写了内容，自动映射到最接近的选项
const VALID_DIRECTIONS    = ['爱恋甜蜜', '虐恋错过', '江湖侠义', '自定义'];
const VALID_RELATIONSHIPS = ['竹马', '师徒', '师徒 ', '宿敌转恋人', '自定义'];

function _safeDirection(val) {
  return VALID_DIRECTIONS.includes(val) ? val : '爱恋甜蜜';
}
function _safeRelationship(val) {
  // 注意：Dify 工作流中"师徒"枚举值录入时带了尾随空格，需映射
  const MAP = { '竹马': '竹马', '师徒': '师徒 ', '宿敌转恋人': '宿敌转恋人', '自定义': '自定义' };
  return MAP[val] || '竹马';
}

// ───────────────────────────────────────────────────────────
// 内部工具函数
// ───────────────────────────────────────────────────────────

/**
 * 把 base64 字符串（含或不含 data: 前缀）转成 Blob 对象
 */
function _base64ToBlob(base64Str) {
  const full = base64Str.startsWith('data:')
    ? base64Str
    : 'data:image/jpeg;base64,' + base64Str;
  const [header, data] = full.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(data);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * 第一步：把用户照片上传到 Dify，拿到 upload_file_id
 * Dify 要求文件必须先通过 /files/upload 上传，再传给 workflow
 */
async function _uploadPhoto(base64Str, apiKey) {
  const blob = _base64ToBlob(base64Str);
  const form = new FormData();
  form.append('file', blob, 'photo.jpg');
  form.append('user', _getUserId());

  const res = await fetch(`${DIFY_BASE}/files/upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`照片上传失败（${res.status}）：${msg}`);
  }

  const json = await res.json();
  return json.id;  // upload_file_id
}

/**
 * 调用 Dify Workflow（blocking 模式），返回 outputs 对象
 * 默认 90 秒超时，超时后抛错让调用方处理
 */
async function _runWorkflow(apiKey, inputs, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${DIFY_BASE}/workflows/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs,
        response_mode: 'blocking',
        user: _getUserId(),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('请求超时（超过 90 秒），请检查网络或稍后重试');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Workflow 调用失败（${res.status}）：${msg}`);
  }

  const json = await res.json();

  // Dify 返回结构：{ data: { status, outputs, error } }
  const data = json.data || json;
  if (data.status === 'failed') {
    throw new Error(`Workflow 执行失败：${data.error || '未知错误'}`);
  }

  return data.outputs || {};
}

/**
 * 生成当前用户 ID（有手机号用手机号，否则用随机 ID）
 */
function _getUserId() {
  const phone = localStorage.getItem('userPhone');
  if (phone) return 'user-' + phone;
  let uid = localStorage.getItem('_uid');
  if (!uid) {
    uid = 'anon-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('_uid', uid);
  }
  return uid;
}

// ───────────────────────────────────────────────────────────
// 对外暴露的三个函数（与原 config.js 接口完全兼容）
// ───────────────────────────────────────────────────────────

/**
 * 【第一步】生成古风同人图
 *
 * @param {string} photoBase64   用户照片 base64（step4.html 传入，已去掉 data: 前缀）
 * @param {number} dramaIndex    剧集下标 0/1/2
 * @param {string} characterName 所选角色名
 * @returns {{ success, imageUrl, prompt, style } | { success: false, error }}
 */
async function generateAncientStyleImage(photoBase64, dramaIndex, characterName) {
  try {
    // 1. 上传照片，拿到 Dify 文件 ID
    console.log('[DEBUG] ① photoBase64 前20字符:', photoBase64.slice(0, 20), '| 长度:', photoBase64.length);
    const uploadFileId = await _uploadPhoto(photoBase64, API_KEYS.image);
    console.log('[DEBUG] ② 上传成功，upload_file_id:', uploadFileId);

    // 2. 取出用户在 step2 选角色时存入 localStorage 的模板 URL
    //    （见 step2.html 的 charactersByDrama 数据，每个角色都有 templateUrl 字段）
    const templateUrl = localStorage.getItem('selectedTemplateUrl')
      || TEMPLATES.female[0];  // 兜底：取第一张女主模板
    console.log('[DEBUG] ③ selectedTemplateUrl from localStorage:', localStorage.getItem('selectedTemplateUrl'));
    console.log('[DEBUG] ③ 最终 templateUrl:', templateUrl);

    // 3. 剧集名
    const juji = DRAMA_NAMES[dramaIndex] || DRAMA_NAMES[0];
    console.log('[DEBUG] ④ juji:', juji, '| dramaIndex:', dramaIndex);

    // 4. 调用 Dify 生成同人图 workflow
    console.log('[DEBUG] ⑤ 发送 workflow 参数:', JSON.stringify({ upload_file_id: uploadFileId, juji, template_url: templateUrl }));
    const outputs = await _runWorkflow(API_KEYS.image, {
      photo: {
        transfer_method: 'local_file',
        upload_file_id: uploadFileId,
        type: 'image',
      },
      juji: juji,
      template_url: templateUrl,
    });
    console.log('[DEBUG] ⑥ workflow 原始输出:', JSON.stringify(outputs));

    const imageUrl = outputs.image_url || outputs.result || outputs.output || outputs.generated_image || outputs.image || outputs.url || '';
    console.log('[DEBUG] ⑦ 最终 imageUrl:', imageUrl);
    if (!imageUrl) {
      throw new Error(`Workflow 执行成功但未返回图片URL，原始输出：${JSON.stringify(outputs)}`);
    }

    return {
      success: true,
      imageUrl: imageUrl,
      prompt: '古风同人图生成',
      style: '古风',
    };
  } catch (err) {
    console.error('[generateAncientStyleImage]', err);
    return { success: false, error: err.message };
  }
}

/**
 * 【第二步-流式版】生成同人文（streaming）
 * onChunk(visibleText) 每收到新字符就回调，过滤掉 <think> 推理块
 * 返回 { success, novel, title }
 */
async function generateNovelStream({ flowerName, relationship, plotDirection, dramaIndex, characterName }, onChunk) {
  const juji = DRAMA_NAMES[dramaIndex] || DRAMA_NAMES[0];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000); // 流式给 120 秒

  let res;
  try {
    res = await fetch(`${DIFY_BASE}/workflows/run`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEYS.novel}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: {
          flower_name:  flowerName,
          juji:         juji,
          relationship: _safeRelationship(relationship),
          direction:    _safeDirection(plotDirection),
        },
        response_mode: 'streaming',
        user: _getUserId(),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('请求超时（超过 120 秒），请稍后重试');
    throw err;
  }

  if (!res.ok) {
    clearTimeout(timer);
    const msg = await res.text();
    console.error('[DEBUG stream] sent relationship:', JSON.stringify(_safeRelationship(relationship)), '| direction:', JSON.stringify(_safeDirection(plotDirection)));
    throw new Error(`Workflow 调用失败（${res.status}）：${msg}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';
  let rawText   = '';          // 累计原始文字（含 think 块）
  let visibleLen = 0;          // 已推送给 onChunk 的可见字符数

  // 从 rawText 中提取 <think>...</think> 外的全部可见文字
  function extractVisible(text) {
    let out = '', pos = 0, inThink = false;
    while (pos < text.length) {
      if (!inThink) {
        const s = text.indexOf('<think>', pos);
        if (s === -1) { out += text.slice(pos); break; }
        out += text.slice(pos, s);
        inThink = true; pos = s + 7;
      } else {
        const e = text.indexOf('</think>', pos);
        if (e === -1) break;         // think 块未结束，等下一个 chunk
        inThink = false; pos = e + 8;
      }
    }
    return out;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // 保留未完整的行

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;

      try {
        const evt = JSON.parse(jsonStr);

        // LLM 节点流式文字片段
        if (evt.event === 'text_chunk' && evt.data?.text) {
          rawText += evt.data.text;
          const visible = extractVisible(rawText);
          if (visible.length > visibleLen) {
            onChunk(visible.slice(visibleLen));
            visibleLen = visible.length;
          }
        }

        // 工作流结束，返回完整 story（兜底）
        if (evt.event === 'workflow_finished') {
          const outputs = evt.data?.outputs || {};
          const finalStory = (outputs.story || rawText)
            .replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
          return { success: true, novel: finalStory, title: flowerName + '传 · ' + juji + '篇' };
        }

        if (evt.event === 'error') {
          throw new Error(evt.message || 'SSE 流式错误');
        }
      } catch (e) { /* 跳过非 JSON 行 */ }
    }
  }

  clearTimeout(timer);
  // 未收到 workflow_finished 时的兜底
  const fallback = extractVisible(rawText).trim();
  return { success: true, novel: fallback, title: flowerName + '传 · ' + juji + '篇' };
}

/**
 * 【第二步】生成同人文
 *
 * @param {{ flowerName, relationship, plotDirection, dramaIndex, characterName }}
 * @returns {{ success, novel, title } | { success: false, error }}
 */
async function generateNovel({ flowerName, relationship, plotDirection, dramaIndex, characterName }) {
  try {
    const juji = DRAMA_NAMES[dramaIndex] || DRAMA_NAMES[0];

    const _rel = _safeRelationship(relationship);
    const _dir = _safeDirection(plotDirection);
    console.log('[generateNovel] 发送参数 →', JSON.stringify({ flower_name: flowerName, juji, relationship: _rel, direction: _dir }));

    const outputs = await _runWorkflow(API_KEYS.novel, {
      flower_name:  flowerName,
      juji:         juji,
      relationship: _rel,
      direction:    _dir,
    });

    // 过滤掉模型输出的 <think>...</think> 推理过程，只保留正文
    const rawStory = outputs.story || '';
    const cleanStory = rawStory.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    return {
      success: true,
      novel: cleanStory,
      title: flowerName + '传 · ' + juji + '篇',
    };
  } catch (err) {
    console.error('[generateNovel] 失败:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 【第三步】生成 CP 合照
 *
 * @param {string} userImageUrl  第一步生成的换脸图 URL（已存入 localStorage: generatedImage）
 * @param {string} cpName        所选 CP 角色名（仅用于日志，不传给 API）
 * @param {number} dramaIndex    剧集下标
 * @returns {{ success, imageUrl } | { success: false, error }}
 */
async function generateCPImage(userImageUrl, cpName, dramaIndex) {
  try {
    // 取出用户在 step6 选 CP 时存入 localStorage 的 CP 模板 URL
    // （见 step6_cp.html 的 dramaCharacters 数据，每个角色都有 templateUrl 字段）
    const cpTemplateUrl = localStorage.getItem('selectedCPTemplateUrl')
      || TEMPLATES.male[0];  // 兜底：取第一张男主模板

    // 根据用户模板性别 + CP 模板性别自动计算 combo_desc
    const userTemplateUrl = localStorage.getItem('selectedTemplateUrl') || '';
    const userIsFemale = userTemplateUrl.includes('female');
    const cpIsFemale   = cpTemplateUrl.includes('female');
    let combo_desc;
    if (userIsFemale && !cpIsFemale) {
      combo_desc = '一男一女古风双人合照';
    } else if (!userIsFemale && cpIsFemale) {
      combo_desc = '一男一女古风双人合照';
    } else if (userIsFemale && cpIsFemale) {
      combo_desc = '两位女子古风双人合照';
    } else {
      combo_desc = '两位男子古风双人合照';
    }

    const outputs = await _runWorkflow(API_KEYS.cp, {
      user_image_url:  userImageUrl,
      cp_template_url: cpTemplateUrl,
      combo_desc:      combo_desc,
    });

    // CP 工作流返回的字段名是 image_url_（末尾有下划线）
    const imageUrl = outputs.image_url_
      || outputs.image_url
      || outputs.result
      || outputs.output
      || outputs.generated_image
      || outputs.image
      || outputs.url
      || '';

    return {
      success: true,
      imageUrl: imageUrl,
      _rawOutputs: outputs,  // 保留原始输出，方便调试
    };
  } catch (err) {
    console.error('[generateCPImage]', err);
    return { success: false, error: err.message };
  }
}
