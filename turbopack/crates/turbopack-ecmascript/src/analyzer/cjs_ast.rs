use swc_core::{
    common::Mark,
    ecma::ast::{
        AssignExpr, AssignOp, AssignTarget, Expr, Ident, MemberExpr, MemberProp, ObjectLit, Prop,
        PropName, PropOrSpread, SimpleAssignTarget,
    },
};
use turbo_rcstr::RcStr;

use crate::utils::unparen;

/// True if `prop` is the non-computed member property `.<name>`.
fn prop_is(prop: &MemberProp, name: &str) -> bool {
    matches!(prop, MemberProp::Ident(i) if i.sym.as_ref() == name)
}

/// Whether a property key is the identifier or string `name`.
pub(crate) fn prop_name_is(key: &PropName, name: &str) -> bool {
    match key {
        PropName::Ident(i) => i.sym.as_ref() == name,
        PropName::Str(s) => &*s.value.to_string_lossy() == name,
        _ => false,
    }
}

/// True if `identifier` is the named, unshadowed module-scope (unresolved)
/// binding — e.g. the real CommonJS `module`/`exports`/`require`, not a local
/// shadow. Prevents `let exports = {}; exports.foo = 'a'` from being treated as
/// a write to the global `exports`.
pub(crate) fn is_global(identifier: &Ident, name: &str, unresolved_mark: Mark) -> bool {
    identifier.ctxt.outer() == unresolved_mark && identifier.sym.as_ref() == name
}

/// `module.exports` (the real, unshadowed `module` binding).
pub(crate) fn is_module_dot_exports(member: &MemberExpr, unresolved_mark: Mark) -> bool {
    matches!(unparen(&member.obj), Expr::Ident(o) if is_global(o, "module", unresolved_mark))
        && prop_is(&member.prop, "exports")
}

/// Whether `expr` is the real (unshadowed) `exports` or `module.exports`.
pub(crate) fn is_exports_object(expr: &Expr, unresolved_mark: Mark) -> bool {
    match unparen(expr) {
        Expr::Ident(o) => is_global(o, "exports", unresolved_mark),
        Expr::Member(inner) => is_module_dot_exports(inner, unresolved_mark),
        _ => false,
    }
}

/// `module.exports` or a property chain rooted at it (`module.exports.a.b`).
pub(crate) fn is_module_exports_chain(expr: &Expr, unresolved_mark: Mark) -> bool {
    match unparen(expr) {
        Expr::Member(m) => {
            is_module_dot_exports(m, unresolved_mark)
                || is_module_exports_chain(&m.obj, unresolved_mark)
        }
        _ => false,
    }
}

/// The object literal of a `module.exports = { … }` whole-exports assignment,
/// whose properties are the module's named exports.
pub(crate) fn as_module_exports_object_literal(
    n: &AssignExpr,
    unresolved_mark: Mark,
) -> Option<&ObjectLit> {
    if n.op != AssignOp::Assign {
        return None;
    }
    let AssignTarget::Simple(SimpleAssignTarget::Member(member)) = &n.left else {
        return None;
    };
    if !is_module_dot_exports(member, unresolved_mark) {
        return None;
    }
    match unparen(&n.right) {
        Expr::Object(obj) => Some(obj),
        _ => None,
    }
}

/// The droppable named exports of a `module.exports = { … }` literal. `None` if a
/// spread or computed key makes the set unknown.
pub(crate) fn static_prop_names(obj: &ObjectLit) -> Option<Vec<RcStr>> {
    let mut names = Vec::with_capacity(obj.props.len());
    for prop in &obj.props {
        let PropOrSpread::Prop(prop) = prop else {
            return None; // spread → unknown export set
        };
        match &**prop {
            Prop::Shorthand(id) => names.push(RcStr::from(id.sym.as_str())),
            Prop::KeyValue(kv) => {
                let name = match &kv.key {
                    PropName::Ident(i) => RcStr::from(i.sym.as_str()),
                    PropName::Str(s) => RcStr::from(s.value.to_string_lossy().into_owned()),
                    _ => return None, // computed / numeric / bigint key
                };
                if is_pure_object_value(&kv.value) {
                    names.push(name);
                }
            }
            _ => {}
        }
    }
    Some(names)
}

fn is_pure_object_value(expr: &Expr) -> bool {
    matches!(
        unparen(expr),
        Expr::Ident(_) | Expr::Lit(_) | Expr::Fn(_) | Expr::Arrow(_) | Expr::Class(_)
    )
}

/// Whether `member` writes the module's own CommonJS exports: `exports.<x>`,
/// `module.exports`, or `module.exports.<x>`.
pub(crate) fn is_cjs_export_member(member: &MemberExpr, unresolved_mark: Mark) -> bool {
    match unparen(&member.obj) {
        // `exports.<anything>`, or `module.exports`
        Expr::Ident(obj) => {
            is_global(obj, "exports", unresolved_mark)
                || is_module_dot_exports(member, unresolved_mark)
        }
        // `module.exports.<anything>`
        Expr::Member(inner) => is_cjs_export_member(inner, unresolved_mark),
        _ => false,
    }
}
