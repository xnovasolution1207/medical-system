import React, { useState, useRef, useEffect, KeyboardEvent } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChannelAvatar } from "./ChannelAvatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, Conversation } from "./types";
import { ImageLightbox } from "./ImageLightbox";
import { VideoLightbox } from "./VideoLightbox";
import { Phone, Mail, Tag, Calendar, CheckSquare, Plus, BellOff, X, ChevronDown, Edit2, Trash2, FileIcon, ImageIcon, Download, MapPin, FileText, Users, Headphones, Link as LinkIcon, Play } from "lucide-react";

const MOCK_AGENTS = [
  { id: "a1", name: "Agente de Ventas", avatar: "https://i.pravatar.cc/150?u=a1" },
  { id: "a2", name: "María González", avatar: "https://i.pravatar.cc/150?u=a2" },
  { id: "a3", name: "Carlos López", avatar: "https://i.pravatar.cc/150?u=a3" },
  { id: "a4", name: "Ana Martínez", avatar: "https://i.pravatar.cc/150?u=a4" },
];

interface ContactSidebarProps {
  contact: User;
  conversation?: Conversation;
  onUpdateContactName?: (name: string) => void;
}

export function ContactSidebar({ contact, conversation, onUpdateContactName }: ContactSidebarProps) {
  const [tags, setTags] = useState<string[]>(contact.tags || []);
  const [newTag, setNewTag] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [selectedFollowers, setSelectedFollowers] = useState<string[]>(["a2"]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isEditingFields, setIsEditingFields] = useState(false);
  const [fields, setFields] = useState<any[]>([
    { id: 'phone', label: 'Teléfono', value: contact.phone || '', type: 'phone' },
    { id: 'email', label: 'Email', value: contact.email || '', type: 'email' },
    { id: 'address', label: 'Dirección', value: '', type: 'address' },
    { id: 'document', label: 'Num de documento', value: '', type: 'document', docType: 'CC' },
    { id: 'relationship', label: 'Parentesco', value: '', type: 'relationship' }
  ]);

  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(contact.name);

  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editedFieldValue, setEditedFieldValue] = useState("");
  const [editedDocType, setEditedDocType] = useState("CC");

  const handleEditFieldStart = (field: any) => {
    setEditingFieldId(field.id);
    setEditedFieldValue(field.value);
    if (field.type === 'document') {
      setEditedDocType(field.docType || 'CC');
    }
  };

  const handleEditFieldSave = () => {
    if (editingFieldId) {
      setFields(fields.map(f => {
        if (f.id === editingFieldId) {
          return { ...f, value: editedFieldValue, ...(f.type === 'document' ? { docType: editedDocType } : {}) };
        }
        return f;
      }));
    }
    setEditingFieldId(null);
  };

  const handleEditFieldKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleEditFieldSave();
    } else if (e.key === "Escape") {
      setEditingFieldId(null);
    }
  };

  useEffect(() => {
    setTags(contact.tags || []);
    setFields([
      { id: 'phone', label: 'Teléfono', value: contact.phone || '', type: 'phone' },
      { id: 'email', label: 'Email', value: contact.email || '', type: 'email' },
      { id: 'address', label: 'Dirección', value: '', type: 'address' },
      { id: 'document', label: 'Num de documento', value: '', type: 'document', docType: 'CC' },
      { id: 'relationship', label: 'Parentesco', value: '', type: 'relationship' }
    ]);
  }, [contact.tags, contact.phone, contact.email]);

  useEffect(() => {
    setEditedName(contact.name);
  }, [contact.name]);

  const handleNameSave = () => {
    if (editedName.trim() && editedName !== contact.name) {
      onUpdateContactName?.(editedName.trim());
    } else {
      setEditedName(contact.name);
    }
    setIsEditingName(false);
  };
  
  const handleNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleNameSave();
    } else if (e.key === "Escape") {
      setEditedName(contact.name);
      setIsEditingName(false);
    }
  };

  const handleAddTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()]);
    }
    setNewTag("");
    setIsAddingTag(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTag();
    } else if (e.key === "Escape") {
      setNewTag("");
      setIsAddingTag(false);
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };
  return (
    <div className="flex h-full w-full flex-col border-l bg-card text-card-foreground overflow-hidden">
      <ScrollArea className="flex-1">
        <div className="flex flex-col items-center p-6 text-center">
          <ChannelAvatar 
            name={contact.name} 
            src={contact.avatar} 
            status={contact.status}
            className="h-24 w-24 mb-4"
          />
          {isEditingName ? (
            <input
              autoFocus
              className="text-xl font-bold text-center bg-transparent border-b border-primary focus:outline-none mb-1 w-full max-w-[200px] px-2"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={handleNameKeyDown}
            />
          ) : (
            <div 
              className="group relative flex items-center justify-center gap-2 cursor-pointer w-full mb-1 rounded-md hover:bg-muted/50 p-1 -mx-1"
              onClick={() => setIsEditingName(true)}
            >
              <h2 className="text-xl font-bold">{contact.name}</h2>
              <Edit2 className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity absolute right-4 sm:right-8" />
            </div>
          )}
          <p className="text-sm text-muted-foreground mb-4">Lead</p>
          
          <div className="flex gap-2 w-full">
            <Button variant="outline" className="flex-1 gap-2">
              <Phone className="h-4 w-4" />
              Llamar
            </Button>
            <Button variant="outline" className="flex-1 gap-2">
              <Mail className="h-4 w-4" />
              Email
            </Button>
          </div>
        </div>

        <Separator />

        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Etiquetas</h3>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setIsAddingTag(true); setTimeout(() => inputRef.current?.focus(), 0); }}><Plus className="h-4 w-4" /></Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="font-normal group pr-1.5 flex items-center gap-1">
                {tag}
                <button 
                  onClick={() => removeTag(tag)}
                  className="h-3.5 w-3.5 rounded-full hover:bg-muted-foreground/20 flex items-center justify-center text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
            {isAddingTag ? (
              <input
                ref={inputRef}
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleAddTag}
                className="inline-flex h-[22px] w-[100px] items-center rounded-md border border-input bg-transparent px-2 text-xs font-normal focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Escribir..."
              />
            ) : (
              <button 
                onClick={() => { setIsAddingTag(true); setTimeout(() => inputRef.current?.focus(), 0); }}
                className="inline-flex h-[22px] items-center rounded-md border border-dashed border-input bg-transparent px-2 text-xs font-normal text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
              >
                <Plus className="mr-1 h-3 w-3" /> Añadir
              </button>
            )}
          </div>
        </div>

        <Separator />

        <div className="p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Información de Contacto</h3>
              {!isEditingFields && (
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={() => setIsEditingFields(true)}>
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </div>
            
            {isEditingFields ? (
              <div className="space-y-3">
                {fields.map((field, index) => (
                  <div key={field.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <input 
                        value={field.label} 
                        onChange={(e) => {
                          const newFields = [...fields];
                          newFields[index].label = e.target.value;
                          setFields(newFields);
                        }} 
                        className="h-8 w-1/3 rounded-md border border-input bg-transparent px-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                        placeholder="Etiqueta"
                        disabled={['phone', 'email', 'address', 'document', 'relationship'].includes(field.id)}
                      />
                      
                      {field.type === 'document' ? (
                        <div className="flex flex-1 gap-1">
                          <Select 
                            value={field.docType || 'CC'} 
                            onValueChange={(val) => {
                              const newFields = [...fields];
                              newFields[index].docType = val;
                              setFields(newFields);
                            }}
                          >
                            <SelectTrigger className="h-8 w-[70px] text-xs px-2 border-input bg-transparent">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="CC">CC</SelectItem>
                              <SelectItem value="CE">CE</SelectItem>
                              <SelectItem value="NIT">NIT</SelectItem>
                              <SelectItem value="Pasaporte">Pasaporte</SelectItem>
                            </SelectContent>
                          </Select>
                          <input 
                            value={field.value} 
                            onChange={(e) => {
                              const newFields = [...fields];
                              newFields[index].value = e.target.value;
                              setFields(newFields);
                            }} 
                            className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            placeholder="Número"
                          />
                        </div>
                      ) : field.type === 'relationship' ? (
                        <Select 
                          value={field.value} 
                          onValueChange={(val) => {
                            const newFields = [...fields];
                            newFields[index].value = val;
                            setFields(newFields);
                          }}
                        >
                          <SelectTrigger className="h-8 flex-1 text-xs px-2 border-input bg-transparent">
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Hijo(a)">Hijo(a)</SelectItem>
                            <SelectItem value="Padre/Madre">Padre/Madre</SelectItem>
                            <SelectItem value="Esposo(a)">Esposo(a)</SelectItem>
                            <SelectItem value="Hermano(a)">Hermano(a)</SelectItem>
                            <SelectItem value="Otro">Otro</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <input 
                          value={field.value} 
                          onChange={(e) => {
                            const newFields = [...fields];
                            newFields[index].value = e.target.value;
                            setFields(newFields);
                          }} 
                          className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          placeholder="Valor"
                        />
                      )}

                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" onClick={() => {
                        setFields(fields.filter(f => f.id !== field.id));
                      }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="w-full h-8 text-xs border-dashed" onClick={() => {
                  setFields([...fields, { id: `custom_${Date.now()}`, label: 'Nuevo campo', value: '', type: 'custom' }]);
                }}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Agregar campo
                </Button>
                <div className="pt-2">
                  <Button size="sm" className="w-full h-8 text-xs" onClick={() => setIsEditingFields(false)}>Guardar cambios</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1 text-sm">
                {fields.map(field => (
                  <div 
                    key={field.id} 
                    className="flex items-center justify-between gap-4 group relative rounded-md hover:bg-muted/50 p-2 -mx-2 cursor-pointer transition-colors"
                    onClick={() => editingFieldId !== field.id && handleEditFieldStart(field)}
                  >
                    <span className="text-muted-foreground flex items-center gap-2 shrink-0">
                      {field.type === 'phone' && <Phone className="h-4 w-4" />}
                      {field.type === 'email' && <Mail className="h-4 w-4" />}
                      {field.type === 'address' && <MapPin className="h-4 w-4" />}
                      {field.type === 'document' && <FileText className="h-4 w-4" />}
                      {field.type === 'relationship' && <Users className="h-4 w-4" />}
                      {field.type === 'custom' && <Tag className="h-4 w-4" />}
                      {field.label}
                    </span>
                    
                    {editingFieldId === field.id ? (
                      field.type === 'document' ? (
                        <div 
                          className="flex flex-1 gap-1 justify-end ml-4" 
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                              handleEditFieldSave();
                            }
                          }}
                        >
                          <Select 
                            value={editedDocType} 
                            onValueChange={(val) => {
                              setEditedDocType(val);
                              // We can also auto-save when doc type changes if we want, but let's just update state
                            }}
                          >
                            <SelectTrigger className="h-7 w-[70px] text-xs px-2 border-input bg-background">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="CC">CC</SelectItem>
                              <SelectItem value="CE">CE</SelectItem>
                              <SelectItem value="NIT">NIT</SelectItem>
                              <SelectItem value="Pasaporte">Pasaporte</SelectItem>
                            </SelectContent>
                          </Select>
                          <input 
                            autoFocus
                            value={editedFieldValue} 
                            onChange={(e) => setEditedFieldValue(e.target.value)}
                            onKeyDown={handleEditFieldKeyDown}
                            className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring text-right w-full min-w-[100px]"
                            placeholder="Número"
                          />
                        </div>
                      ) : field.type === 'relationship' ? (
                        <div className="flex-1 ml-4 justify-end flex" onClick={(e) => e.stopPropagation()}>
                          <Select 
                            value={editedFieldValue} 
                            onValueChange={(val) => {
                              setEditedFieldValue(val);
                              setFields(fields.map(f => f.id === field.id ? { ...f, value: val } : f));
                              setEditingFieldId(null);
                            }}
                          >
                            <SelectTrigger className="h-7 w-full max-w-[150px] text-xs px-2 border-input bg-background" autoFocus>
                              <SelectValue placeholder="Seleccionar" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Hijo(a)">Hijo(a)</SelectItem>
                              <SelectItem value="Padre/Madre">Padre/Madre</SelectItem>
                              <SelectItem value="Esposo(a)">Esposo(a)</SelectItem>
                              <SelectItem value="Hermano(a)">Hermano(a)</SelectItem>
                              <SelectItem value="Otro">Otro</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <div className="flex-1 ml-4" onClick={(e) => e.stopPropagation()}>
                           <input 
                              autoFocus
                              value={editedFieldValue} 
                              onChange={(e) => setEditedFieldValue(e.target.value)}
                              onBlur={handleEditFieldSave}
                              onKeyDown={handleEditFieldKeyDown}
                              className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring text-right"
                              placeholder="Valor"
                            />
                        </div>
                      )
                    ) : (
                      <div className="flex items-center gap-2 flex-1 justify-end overflow-hidden">
                        <span className="font-medium text-right truncate text-foreground/80">
                          {field.value 
                            ? (field.type === 'document' ? `${field.docType || 'CC'} ${field.value}` : field.value) 
                            : <span className="text-muted-foreground/50 italic">Vacío</span>}
                        </span>
                        <Edit2 className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </div>
                    )}
                  </div>
                ))}
                {fields.length === 0 && (
                  <span className="text-muted-foreground text-xs italic">Sin información</span>
                )}
              </div>
            )}
          </div>
        </div>

        <Separator />

        <div className="p-4 space-y-4">
          <h3 className="text-sm font-semibold">Asignación</h3>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Propietario</Label>
              <Select defaultValue="a1">
                <SelectTrigger className="w-full [&>span]:flex [&>span]:items-center [&>span]:gap-2">
                  <SelectValue placeholder="Seleccionar propietario" />
                </SelectTrigger>
                <SelectContent>
                  {MOCK_AGENTS.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={agent.avatar} />
                          <AvatarFallback>{agent.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span>{agent.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Seguidores</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between font-normal px-3 h-10 bg-background hover:bg-background">
                    <div className="flex items-center gap-2 overflow-hidden truncate">
                      {selectedFollowers.length > 0 ? (
                        selectedFollowers.length === 1 ? (
                          <div className="flex items-center gap-2">
                            <Avatar className="h-5 w-5">
                              <AvatarImage src={MOCK_AGENTS.find(a => a.id === selectedFollowers[0])?.avatar} />
                              <AvatarFallback>{MOCK_AGENTS.find(a => a.id === selectedFollowers[0])?.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <span className="truncate">{MOCK_AGENTS.find(a => a.id === selectedFollowers[0])?.name}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="flex -space-x-2">
                              {selectedFollowers.slice(0, 3).map(id => {
                                const agent = MOCK_AGENTS.find(a => a.id === id);
                                return (
                                  <Avatar key={id} className="h-5 w-5 border-2 border-background">
                                    <AvatarImage src={agent?.avatar} />
                                    <AvatarFallback>{agent?.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                                  </Avatar>
                                );
                              })}
                            </div>
                            <span className="truncate text-sm">{selectedFollowers.length} seleccionados</span>
                          </div>
                        )
                      ) : (
                        <span className="text-muted-foreground">Seleccionar seguidores</span>
                      )}
                    </div>
                    <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[280px]" align="start">
                  {MOCK_AGENTS.map((agent) => (
                    <DropdownMenuCheckboxItem
                      key={agent.id}
                      checked={selectedFollowers.includes(agent.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedFollowers([...selectedFollowers, agent.id]);
                        } else {
                          setSelectedFollowers(selectedFollowers.filter(id => id !== agent.id));
                        }
                      }}
                      onSelect={(e) => e.preventDefault()}
                    >
                      <div className="flex items-center gap-2 ml-2">
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={agent.avatar} />
                          <AvatarFallback>{agent.name.substring(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span>{agent.name}</span>
                      </div>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <Separator />

        <div className="p-4 space-y-4 pb-8">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Documentos</h3>
            <Badge variant="secondary" className="text-xs font-normal">
              {conversation?.messages.filter(m => m.attachment).length || 0}
            </Badge>
          </div>
          
          <Tabs defaultValue="image" className="w-full">
            <TabsList className="w-full grid grid-cols-4 h-9 bg-muted/50 p-1">
              <TabsTrigger value="image" className="text-[10px] sm:text-xs px-1">Imagen</TabsTrigger>
              <TabsTrigger value="doc" className="text-[10px] sm:text-xs px-1">Doc</TabsTrigger>
              <TabsTrigger value="link" className="text-[10px] sm:text-xs px-1">Enlaces</TabsTrigger>
              <TabsTrigger value="media" className="text-[10px] sm:text-xs px-1">Multimedia</TabsTrigger>
            </TabsList>
            
            {["image", "doc", "link", "media"].map((tab) => {
              const filteredDocs = conversation?.messages.filter(m => {
                if (!m.attachment) return false;
                const type = m.attachment.type;
                if (tab === "image") return type === "image";
                if (tab === "doc") return type === "document" || type === "file";
                if (tab === "link") return type === "link";
                if (tab === "media") return type === "audio" || type === "video";
                return false;
              }) || [];

              return (
                <TabsContent key={tab} value={tab} className="mt-4 space-y-2">
                  {filteredDocs.length > 0 ? (
                    filteredDocs.map((msg, idx) => (
                      <div key={idx} className="flex items-center gap-3 p-3 rounded-xl border bg-card hover:bg-accent/50 transition-colors group cursor-pointer shadow-sm">
                        {msg.attachment?.type === 'image' && msg.attachment.url ? (
                          <ImageLightbox
                            src={msg.attachment.url}
                            alt={msg.attachment.name}
                            className="h-10 w-10 shrink-0 border bg-muted"
                          >
                            <img src={msg.attachment.url} alt={msg.attachment.name} className="h-full w-full object-cover" />
                          </ImageLightbox>
                        ) : msg.attachment?.type === 'video' && msg.attachment.url ? (
                          <VideoLightbox
                            src={msg.attachment.url}
                            alt={msg.attachment.name}
                            className="h-10 w-10 shrink-0 border bg-black"
                          >
                            <div className="relative h-full w-full">
                              <video
                                src={msg.attachment.url}
                                preload="metadata"
                                muted
                                playsInline
                                className="h-full w-full object-cover"
                              />
                              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
                                <Play className="h-4 w-4 text-white" fill="currentColor" />
                              </div>
                            </div>
                          </VideoLightbox>
                        ) : (
                          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                            {msg.attachment?.type === 'audio' ? <Headphones className="h-5 w-5" /> :
                             msg.attachment?.type === 'link' ? <LinkIcon className="h-5 w-5" /> :
                             <FileIcon className="h-5 w-5" />}
                          </div>
                        )}
                        <div className="flex flex-col overflow-hidden flex-1">
                          <span className="text-sm font-medium truncate">{msg.attachment?.name || 'Documento'}</span>
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{msg.attachment?.type}</span>
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 shrink-0 text-muted-foreground hover:text-foreground">
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-xs text-muted-foreground bg-muted/30 rounded-xl border border-dashed">
                      No hay archivos de este tipo
                    </div>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        </div>

      </ScrollArea>
    </div>
  );
}
