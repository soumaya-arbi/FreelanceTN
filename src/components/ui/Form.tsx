"use client";
import React from "react";

function EditorHeading({title,text}:{title:string;text:string}) {
  return <div className="editor-heading"><h2>{title}</h2><p>{text}</p></div>;
}

function FormField({label,children}:{label:string;children:React.ReactNode}) {
  return <label className="editor-field"><span>{label}</span>{children}</label>;
}

export { EditorHeading, FormField };
